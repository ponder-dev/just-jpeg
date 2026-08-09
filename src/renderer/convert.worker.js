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
  extractExif, readOrientation, setOrientation, finalizeJpeg, heifHasTransform, buildExif, iccFromHeif,
} from '../exif.js';

let heif = null;
let libraw = null;
let mozjpegReady = null;

function getHeif() {
  // Compiling ~1MB of WASM is synchronous, which is exactly why this lives in
  // a worker and not on the UI thread.
  if (!heif) heif = libheifFactory();
  return heif;
}

// The canvas encoder always writes 4:2:0, which throws away half the colour
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

// ------------------------------------------------------------ file sniffing ---

const HEIF_BRANDS = new Set([
  'heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs',
  'mif1', 'msf1', 'avif', 'avis', 'mia1', 'mia3', 'avci',
]);

function fourCC(b, o) {
  return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
}

/** Decide how to decode, from the bytes rather than the file extension. */
export function sniff(b) {
  if (b.length < 12) return 'unknown';
  if (b[0] === 0xff && b[1] === 0xd8) return 'native';                       // JPEG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'native';
  if (fourCC(b, 0) === 'GIF8') return 'native';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'native';                       // BMP
  if (fourCC(b, 0) === 'RIFF' && fourCC(b, 8) === 'WEBP') return 'native';
  if (fourCC(b, 4) === 'ftyp') {
    return HEIF_BRANDS.has(fourCC(b, 8).toLowerCase()) ? 'heif' : 'raw';     // crx (CR3) lands in raw
  }
  if (fourCC(b, 0).startsWith('FUJI')) return 'raw';                          // RAF
  const le = b[0] === 0x49 && b[1] === 0x49;
  const be = b[0] === 0x4d && b[1] === 0x4d;
  if (le || be) return 'raw';   // TIFF-based: DNG, CR2, NEF, ARW, ORF, RW2...
  return 'unknown';
}

// ----------------------------------------------------------------- decoders ---

async function decodeHeif(bytes) {
  const lib = getHeif();
  const images = new lib.HeifDecoder().decode(bytes);
  if (!images || !images.length) throw new Error('No image found inside this HEIC file');

  const img = images[0];
  const width = img.get_width();
  const height = img.get_height();
  if (!width || !height) throw new Error('HEIC reports a zero-sized image');

  const out = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  await new Promise((resolve, reject) => {
    img.display(out, (result) => (result ? resolve(result) : reject(new Error('HEIC decode failed'))));
  });
  // Some builds hold native memory until told otherwise.
  try { img.free && img.free(); } catch { /* not fatal */ }

  return new ImageData(out.data, width, height);
}

/** Plain TIFFs (scanners, exports) are not RAW, so libraw refuses them. */
function decodeTiff(bytes) {
  const ifds = UTIF.decode(bytes);
  if (!ifds || !ifds.length) throw new Error('No image found inside this TIFF');
  const page = ifds[0];
  UTIF.decodeImage(bytes, page, ifds);
  const rgba = UTIF.toRGBA8(page);
  if (!page.width || !page.height) throw new Error('TIFF reports a zero-sized image');
  return new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), page.width, page.height);
}

async function decodeRaw(bytes) {
  const LibRaw = await getLibRaw();
  const lr = new LibRaw();
  try {
    // open() hands the buffer to libraw's own worker, which detaches it. Pass
    // a copy, or the caller is left holding an empty ArrayBuffer.
    await lr.open(bytes.slice());
    const img = await lr.imageData();
    if (!img || !img.width || !img.height) throw new Error('RAW decoder returned no image');

    const { width, height } = img;
    const src = img.data;
    const channels = src.length / (width * height);
    const rgba = new Uint8ClampedArray(width * height * 4);

    // libraw hands back 3- or 4-channel data, 8 or 16 bits deep.
    const sixteenBit = src.BYTES_PER_ELEMENT === 2;
    const shift = sixteenBit ? 8 : 0;
    for (let i = 0, p = 0, q = 0; i < width * height; i++) {
      rgba[q++] = shift ? src[p] >> shift : src[p]; p++;
      rgba[q++] = shift ? src[p] >> shift : src[p]; p++;
      rgba[q++] = shift ? src[p] >> shift : src[p]; p++;
      rgba[q++] = channels >= 4 ? (shift ? src[p++] >> shift : src[p++]) : 255;
    }

    // A RAW file's own TIFF structure is far too large to embed in a JPEG, so
    // collect the values we care about and write a small EXIF block later.
    let meta = null;
    try {
      const m = await lr.metadata(true);
      if (m) {
        meta = {
          make: m.camera_make,
          model: m.camera_model,
          date: m.timestamp,
          iso: m.iso_speed,
          exposureTime: m.shutter,
          fNumber: m.aperture,
          focalLength: m.focal_len,
          artist: m.artist,
          lens: m.lens && m.lens.Lens,
        };
      }
    } catch { /* metadata is a bonus, not a reason to fail the conversion */ }

    return { image: new ImageData(rgba, width, height), meta };
  } finally {
    try { lr.dispose(); } catch { /* already gone */ }
  }
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

async function convert({ bytes, format, quality, maxDim, keepMetadata, maxQuality }) {
  const input = new Uint8Array(bytes);
  const kind = sniff(input);
  if (kind === 'unknown') throw new Error('Not an image file we recognise');

  let decoded;
  let rawMeta = null;
  if (kind === 'heif') {
    decoded = await decodeHeif(input);
  } else if (kind === 'raw') {
    // TIFF-based files split two ways: real camera RAW, and ordinary TIFFs
    // that libraw will not touch. Try RAW first, then fall back.
    try {
      const result = await decodeRaw(input);
      decoded = result.image;
      rawMeta = result.meta;
    } catch (rawError) {
      try {
        decoded = decodeTiff(input);
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

  // Only HEIF needs its profile carried by hand. createImageBitmap already
  // converts other formats into the canvas colour space, and libraw outputs
  // sRGB, so in both of those cases an untagged JPEG is already correct.
  const icc = kind === 'heif' ? iccFromHeif(input) : null;

  // Work out whether the pixels we just got back are already upright.
  //   native : createImageBitmap honours EXIF orientation itself
  //   heif   : libheif applies container rotation (irot/imir) while decoding
  //   raw    : libraw applies the camera's flip while processing
  // Rotating again in any of those cases would tip the photo on its side.
  let orientation = 1;
  if (kind === 'heif' && !heifHasTransform(input)) {
    orientation = tiff ? readOrientation(tiff) : 1;
  }

  const drawable = await toDrawable(decoded);
  const canvas = render(drawable, srcW, srcH, orientation, maxDim);
  try { drawable.close && drawable.close(); } catch { /* fine */ }

  let out;
  if (format !== 'png' && maxQuality) {
    await getMozjpeg();
    const ctx = canvas.getContext('2d');
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const encoded = await encodeMozjpeg(pixels, {
      quality,
      auto_subsample: false,
      chroma_subsample: 1,     // 4:4:4, full colour resolution
      progressive: true,
      optimize_coding: true,
    });
    out = new Uint8Array(encoded);
  } else {
    const mime = format === 'png' ? 'image/png' : 'image/jpeg';
    const blob = await canvas.convertToBlob({ type: mime, quality: quality / 100 });
    out = new Uint8Array(await blob.arrayBuffer());
  }

  // PNG metadata is a different container entirely; we only carry EXIF into
  // JPEG, which is where people actually rely on it. The colour profile goes
  // across either way it is available, since dropping it visibly dulls the
  // photo.
  if (format !== 'png') {
    out = finalizeJpeg(out, {
      exif: keepMetadata && tiff ? setOrientation(tiff, 1) : null,
      icc,
    });
  }

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
