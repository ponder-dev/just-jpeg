// The conversion worker. One of these runs per CPU core.
//
// Decoding is the expensive part and it happens here in WASM, off the UI
// thread. Encoding hands off to the browser's own JPEG/PNG encoder via
// OffscreenCanvas, which is native code and much faster than any JS encoder
// we could ship.

import libheifFactory from 'libheif-js/libheif-wasm/libheif-bundle.mjs';
import UTIF from 'utif';
import encodeMozjpeg, { init as initMozjpeg } from '@jsquash/jpeg/encode.js';
import mozjpegWasm from '@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm';
import { render } from '../render.js';
import {
  sniff, extractExif, MESSAGES, decodeHeif as engineDecodeHeif, decodeTiff as engineDecodeTiff,
  orientationFor, profileFor, jpegOptions, finishOutput, isCameraRaw, BACKGROUND,
} from '../engine.js';
import { buildExif } from '../exif.js';
import { decodeRaw as decodeRawShared, RawTimeout } from '../raw.js';

let heif = null;
let libraw = null;
let mozjpegReady = null;

function getHeif() {
  // Compiling ~1MB of WASM is synchronous, which is exactly why this lives in
  // a worker and not on the UI thread.
  if (!heif) heif = libheifFactory();
  return heif;
}

// The canvas encoder always writes 4:2:0, which throws away half the color
// resolution and caps quality at about 37dB PSNR no matter how high the
// quality setting goes. mozjpeg can write 4:4:4, so "highest quality" uses it.
// It is several times slower, which is why it is not the default.
function getMozjpeg() {
  if (!mozjpegReady) {
    mozjpegReady = WebAssembly.compile(mozjpegWasm).then((module) => initMozjpeg(module));
  }
  return mozjpegReady;
}

async function getLibRaw() {
  // Kept out of the bundle on purpose: libraw spawns its own worker and loads
  // a sidecar .wasm, both of which need to stay real files on disk. The URL is
  // built at runtime so the bundler leaves this import alone.
  if (!libraw) {
    const url = new URL('./vendor/libraw/index.js', import.meta.url).href;
    libraw = (await import(url)).default;
  }
  return libraw;
}

// File sniffing lives in ../sniff.js, shared with the command line.

// ----------------------------------------------------------------- decoders ---

// The engine reads the file; this side only wraps the pixels for the canvas.
async function heifToImageData(bytes) {
  const out = await engineDecodeHeif(getHeif(), bytes);
  return new ImageData(out.data, out.width, out.height);
}

/** Plain TIFFs (scanners, exports) are not RAW, so libraw refuses them. */
function tiffToImageData(bytes) {
  const { image, orientation, icc } = engineDecodeTiff(UTIF, bytes);
  return { image: new ImageData(image.data, image.width, image.height), orientation, icc };
}

// The decode itself is src/raw.js, the same code the command line runs; this
// side only says where the LibRaw build is and wraps the pixels for the canvas.
async function decodeRaw(bytes) {
  const out = await decodeRawShared(bytes, { loadLibRaw: getLibRaw });
  return { image: new ImageData(out.data, out.width, out.height), meta: out.meta };
}

async function decodeNative(bytes) {
  return await createImageBitmap(new Blob([bytes]));
}

/** ImageData cannot be drawn directly, so wrap it in a bitmap first. */
async function toDrawable(decoded) {
  if (decoded instanceof ImageData) return await createImageBitmap(decoded);
  return decoded;
}

// -------------------------------------------------------------------- main ---

async function convert({ bytes, name = '', format, quality, maxDim, keepMetadata, maxQuality }) {
  const input = new Uint8Array(bytes);
  let kind = sniff(input);
  if (kind === 'unknown') throw new Error(MESSAGES.unknown);

  let decoded;
  let rawMeta = null;
  let tiffTurn = 1;     // a plain TIFF's own orientation and colour profile
  let tiffIcc = null;
  if (kind === 'heif') {
    try {
      decoded = await heifToImageData(input);
    } catch (heifError) {
      // The bundled libheif reads HEIC (HEVC) but has no AV1, so an AVIF fails
      // there. The browser's own decoder takes AVIF, and turns it upright itself.
      try {
        decoded = await decodeNative(input);
        kind = 'native';
      } catch { throw heifError; }
    }
  } else if (kind === 'raw') {
    // TIFF-based files split two ways: real camera RAW, and ordinary TIFFs
    // that libraw will not touch. Try RAW first, then fall back, but only for
    // a file that is not a camera RAW: a damaged RAW would give its small
    // embedded preview through the TIFF reader (engine.js, isCameraRaw).
    try {
      const result = await decodeRaw(input);
      decoded = result.image;
      rawMeta = result.meta;
    } catch (rawError) {
      if (isCameraRaw(input, name)) {
        throw new Error(rawError instanceof RawTimeout ? rawError.message : MESSAGES.rawDamaged);
      }
      try {
        ({ image: decoded, orientation: tiffTurn, icc: tiffIcc } = tiffToImageData(input));
      } catch (tiffError) {
        throw new Error(`${rawError.message} (also tried TIFF: ${tiffError.message})`);
      }
    }
  } else {
    decoded = await decodeNative(input);
  }

  const srcW = decoded.width;
  const srcH = decoded.height;

  // RAW has no embeddable EXIF block of its own, so synthesise one.
  let tiff = extractExif(input);
  if (!tiff && rawMeta) tiff = buildExif(rawMeta);

  // Which profile to carry and which turn is still ours are the engine's
  // decisions (the same ones the command line makes); here createImageBitmap
  // honours a JPEG's EXIF itself and libheif and libraw have turned theirs.
  const icc = profileFor({ kind, bytes: input, tiffIcc });
  const orientation = orientationFor({ kind, backend: 'app', tiff, bytes: input, tiffTurn });

  const drawable = await toDrawable(decoded);
  const canvas = render(drawable, srcW, srcH, orientation, maxDim, format === 'png' ? null : BACKGROUND);
  try { drawable.close && drawable.close(); } catch { /* fine */ }

  let out;
  if (format !== 'png' && maxQuality) {
    await getMozjpeg();
    const ctx = canvas.getContext('2d');
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const encoded = await encodeMozjpeg(pixels, jpegOptions({ quality, best: true }));   // 4:4:4, full colour resolution
    out = new Uint8Array(encoded);
  } else {
    const mime = format === 'png' ? 'image/png' : 'image/jpeg';
    const blob = await canvas.convertToBlob({ type: mime, quality: quality / 100 });
    out = new Uint8Array(await blob.arrayBuffer());
  }

  // PNG carries no EXIF; JPEG gets the photo details, the profile and the
  // mark. All the engine's, the same as the command line's.
  out = finishOutput({ format, bytes: out, tiff, icc, keepMetadata, width: canvas.width, height: canvas.height });

  return { bytes: out, width: canvas.width, height: canvas.height };
}

self.onmessage = async (e) => {
  const { id, job } = e.data;
  try {
    const result = await convert(job);
    self.postMessage(
      { id, ok: true, bytes: result.bytes.buffer, width: result.width, height: result.height },
      [result.bytes.buffer],
    );
  } catch (err) {
    self.postMessage({ id, ok: false, error: (err && err.message) || String(err) });
  }
};
