#!/usr/bin/env node
// Just JPEG on the command line.
//
// The same decoders, the same EXIF handling and the same output rules as the
// app, shared rather than reimplemented. What it cannot share is the drawing:
// the app rotates and scales on a canvas, so the command line has src/pixels.js
// and @jsquash/resize doing that job on raw buffers.
//
// One deliberate difference, stated everywhere it matters: NO CAMERA RAW.
// The RAW decoder is a web-only build that needs browser workers, and it does
// not survive node. The app converts RAW; this refuses it politely. HEIC,
// which is why this tool exists, works fully.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

import { sniff } from './sniff.js';
import { orient } from './pixels.js';
import { planOutput } from './paths.js';
import {
  extractExif, readOrientation, setOrientation, finalizeJpeg, heifHasTransform, iccFromHeif,
} from './exif.js';

const require_ = createRequire(import.meta.url);
const VERSION = require_('../package.json').version;

const INPUT_EXTS = new Set(['.heic', '.heif', '.avif', '.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp']);
const RAW_EXTS = new Set(['.dng', '.cr2', '.cr3', '.nef', '.arw', '.orf', '.rw2', '.raf', '.raw', '.srw', '.pef']);

/* --- wasm plumbing ------------------------------------------------------ */

// jsquash modules expect a browser fetch for their .wasm. Hand each one a
// compiled module from disk instead, once, on first use.
const codecs = {};
async function codec(name) {
  if (codecs[name]) return codecs[name];
  const load = async (pkg, subpath, wasmRel, initName = 'init') => {
    const mod = await import(`${pkg}/${subpath}`);
    const wasm = path.join(path.dirname(require_.resolve(`${pkg}/package.json`)), wasmRel);
    await mod[initName](await WebAssembly.compile(fs.readFileSync(wasm)));
    return mod.default;
  };
  switch (name) {
    case 'jpeg-encode': codecs[name] = await load('@jsquash/jpeg', 'encode.js', 'codec/enc/mozjpeg_enc.wasm'); break;
    case 'jpeg-decode': codecs[name] = await load('@jsquash/jpeg', 'decode.js', 'codec/dec/mozjpeg_dec.wasm'); break;
    case 'png-encode': codecs[name] = await load('@jsquash/png', 'encode.js', 'codec/pkg/squoosh_png_bg.wasm'); break;
    case 'png-decode': codecs[name] = await load('@jsquash/png', 'decode.js', 'codec/pkg/squoosh_png_bg.wasm'); break;
    case 'webp-decode': codecs[name] = await load('@jsquash/webp', 'decode.js', 'codec/dec/webp_dec.wasm'); break;
    case 'resize': codecs[name] = await load('@jsquash/resize', 'index.js', 'lib/resize/pkg/squoosh_resize_bg.wasm', 'initResize'); break;
    default: throw new Error(`no codec ${name}`);
  }
  return codecs[name];
}

/* --- decoding ----------------------------------------------------------- */

let heifLib = null;

async function decode(bytes, label) {
  const kind = sniff(bytes);

  if (kind === 'heif') {
    if (!heifLib) heifLib = require_('libheif-js');
    const images = new heifLib.HeifDecoder().decode(bytes);
    if (!images || !images.length) throw new Error('No image found inside this HEIC file');
    const img = images[0];
    const width = img.get_width();
    const height = img.get_height();
    const out = { width, height, data: new Uint8ClampedArray(width * height * 4) };
    await new Promise((resolve, reject) => {
      img.display(out, (ok) => (ok ? resolve() : reject(new Error('HEIC decode failed'))));
    });
    try { img.free && img.free(); } catch { /* fine */ }
    // libheif applies the container's own rotation while decoding. Only when
    // the file has none does the EXIF orientation still need applying: the
    // same rule the app uses.
    let orientation = 1;
    const tiff = extractExif(bytes);
    if (!heifHasTransform(bytes)) orientation = tiff ? readOrientation(tiff) : 1;
    return { image: out, orientation, tiff, icc: iccFromHeif(bytes) };
  }

  if (kind === 'raw') {
    // TIFF-shaped files are either an ordinary TIFF, which is fine, or real
    // camera RAW, which the command line does not do. Try TIFF, and if the
    // file is beyond it, say why plainly instead of failing strangely.
    try {
      const UTIF = require_('utif');
      const ifds = UTIF.decode(bytes);
      if (!ifds || !ifds.length) throw new Error('no pages');
      UTIF.decodeImage(bytes, ifds[0], ifds);
      const rgba = UTIF.toRGBA8(ifds[0]);
      if (!ifds[0].width || !ifds[0].height) throw new Error('zero-sized');
      return {
        image: { data: new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), width: ifds[0].width, height: ifds[0].height },
        orientation: 1,
        tiff: extractExif(bytes),
        icc: null,
      };
    } catch {
      throw new Error(
        `${label}: looks like camera RAW, which the command line does not convert. ` +
        'The Just JPEG app does: https://ponderdev.com/justjpeg',
      );
    }
  }

  if (kind === 'native') {
    const b = bytes;
    if (b[0] === 0xff && b[1] === 0xd8) {
      const image = await (await codec('jpeg-decode'))(bytes);
      // The app leans on the browser to apply EXIF rotation to JPEGs. There
      // is no browser here, so read it and apply it ourselves.
      const tiff = extractExif(bytes);
      return { image, orientation: tiff ? readOrientation(tiff) : 1, tiff, icc: null };
    }
    if (b[0] === 0x89 && b[1] === 0x50) {
      return { image: await (await codec('png-decode'))(bytes), orientation: 1, tiff: null, icc: null };
    }
    if (String.fromCharCode(b[0], b[1], b[2], b[3]) === 'RIFF') {
      return { image: await (await codec('webp-decode'))(bytes), orientation: 1, tiff: null, icc: null };
    }
    throw new Error(`${label}: GIF and BMP need the app; the command line reads HEIC, JPEG, PNG, TIFF and WEBP`);
  }

  throw new Error(`${label}: not an image file we recognise`);
}

/* --- the conversion ----------------------------------------------------- */

async function convert(bytes, opts, label) {
  const { image, orientation, tiff, icc } = await decode(bytes, label);

  let upright = orient(image, orientation);

  if (opts.size && Math.max(upright.width, upright.height) > opts.size) {
    const scale = opts.size / Math.max(upright.width, upright.height);
    const width = Math.max(1, Math.round(upright.width * scale));
    const height = Math.max(1, Math.round(upright.height * scale));
    upright = await (await codec('resize'))(
      { data: upright.data, width: upright.width, height: upright.height },
      { width, height },
    );
  }

  let out;
  if (opts.format === 'png') {
    out = new Uint8Array(await (await codec('png-encode'))(upright));
  } else {
    const encoded = await (await codec('jpeg-encode'))(upright, {
      quality: opts.quality,
      // --best keeps full colour resolution, the app's "highest quality" box.
      ...(opts.best ? { auto_subsample: false, chroma_subsample: 1 } : {}),
      progressive: true,
      optimize_coding: true,
    });
    out = new Uint8Array(encoded);
    // Metadata rides across exactly as in the app: the raw EXIF block with
    // orientation rewritten to "already upright". PNG has no EXIF to carry.
    out = finalizeJpeg(out, {
      exif: opts.keepMetadata && tiff ? setOrientation(tiff, 1) : null,
      icc,
    });
  }

  return { bytes: out, width: upright.width, height: upright.height };
}

/* --- files and folders --------------------------------------------------- */

function gather(inputs) {
  const files = [];
  const skipped = [];
  const walk = (p) => {
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      for (const entry of fs.readdirSync(p).sort()) {
        if (!entry.startsWith('.')) walk(path.join(p, entry));
      }
      return;
    }
    const ext = path.extname(p).toLowerCase();
    if (INPUT_EXTS.has(ext)) files.push(p);
    else if (RAW_EXTS.has(ext)) skipped.push(p);
  };
  for (const input of inputs) {
    if (!fs.existsSync(input)) throw new Error(`No such file: ${input}`);
    walk(input);
  }
  return { files, skipped };
}

/* --- interface ----------------------------------------------------------- */

function usage() {
  return `Just JPEG ${VERSION}
Converts HEIC photos (and JPEG, PNG, TIFF, WEBP) to JPEG or PNG.

  justjpeg <files or folders> [options]
  cat IMG_0123.heic | justjpeg > IMG_0123.jpg

Options
  -f, --format <jpeg|png>   what to write. default: jpeg
  -q, --quality <40-100>    jpeg quality. default: 85, the app's default
  -s, --size <pixels>       shrink so the long edge is at most this. default: keep
  -o, --out <dir>           where to write. default: beside each original
      --strip               drop the metadata (date, camera, location)
      --best                full colour resolution, slower, for keepers
      --overwrite           replace an existing output instead of renaming
      --json                one JSON line per file
      --quiet               say nothing but errors
  -h, --help                this
  -V, --version             version

No camera RAW here. The app converts RAW (and GIF and BMP); this does not,
because the RAW decoder needs a browser to run in. Everything else matches
the app: originals are only ever read, dates and cameras survive, and
nothing is uploaded anywhere.`;
}

function parseArgs(argv) {
  const o = { inputs: [], format: 'jpeg', quality: 85, size: 0, out: null,
              keepMetadata: true, best: false, onExisting: 'rename',
              json: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') return { help: true };
    else if (a === '-V' || a === '--version') return { version: true };
    else if (a === '-f' || a === '--format') o.format = argv[++i];
    else if (a === '-q' || a === '--quality') o.quality = Number(argv[++i]);
    else if (a === '-s' || a === '--size') o.size = Number(argv[++i]);
    else if (a === '-o' || a === '--out') o.out = argv[++i];
    else if (a === '--strip') o.keepMetadata = false;
    else if (a === '--best') o.best = true;
    else if (a === '--overwrite') o.onExisting = 'overwrite';
    else if (a === '--json') o.json = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a.startsWith('-') && a !== '-') throw new Error(`Unknown option "${a}"`);
    else o.inputs.push(a);
  }
  if (!['jpeg', 'png'].includes(o.format)) throw new Error(`--format is jpeg or png, not "${o.format}"`);
  if (!(o.quality >= 40 && o.quality <= 100)) throw new Error('--quality is 40 to 100');
  return o;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(usage()); return 0; }
  if (opts.version) { console.log(VERSION); return 0; }

  // Piped: one image in, one image out.
  if (!opts.inputs.length && !process.stdin.isTTY) {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const input = new Uint8Array(Buffer.concat(chunks));
    const r = await convert(input, opts, 'stdin');
    process.stdout.write(r.bytes);
    if (!opts.quiet) process.stderr.write(`${r.width}x${r.height} ${opts.format} to stdout\n`);
    return 0;
  }
  if (!opts.inputs.length) { console.error(usage()); return 1; }

  const { files, skipped } = gather(opts.inputs);
  if (!files.length && !skipped.length) throw new Error('Nothing here that looks like an image');

  let failed = 0;
  for (const file of files) {
    try {
      const bytes = new Uint8Array(fs.readFileSync(file));
      const plan = planOutput(
        { sourcePath: file, outDir: opts.out, format: opts.format, onExisting: opts.onExisting },
        fs.existsSync,
        process.platform,
      );
      if (plan.action === 'skip') {
        if (!opts.quiet) process.stderr.write(`skip  ${file} (output exists)\n`);
        continue;
      }
      const r = await convert(bytes, opts, path.basename(file));
      if (opts.out) fs.mkdirSync(opts.out, { recursive: true });
      fs.writeFileSync(plan.path, r.bytes);
      if (opts.json) {
        console.log(JSON.stringify({ ok: true, in: file, out: plan.path, width: r.width, height: r.height, bytes: r.bytes.length }));
      } else if (!opts.quiet) {
        process.stderr.write(`ok    ${file} -> ${plan.path}  ${r.width}x${r.height}\n`);
      }
    } catch (err) {
      failed++;
      const msg = String(err && err.message || err);
      if (opts.json) console.log(JSON.stringify({ ok: false, in: file, error: msg }));
      else process.stderr.write(`fail  ${msg}\n`);
    }
  }

  for (const s of skipped) {
    if (!opts.quiet) process.stderr.write(`raw   ${s} needs the app, the command line does not do RAW\n`);
  }
  if (skipped.length && !failed && !opts.quiet) {
    process.stderr.write(`${skipped.length} RAW file${skipped.length > 1 ? 's' : ''} left alone. https://ponderdev.com/justjpeg\n`);
  }
  return failed ? 2 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(String(err && err.message || err) + '\n');
    process.exit(1);
  });
