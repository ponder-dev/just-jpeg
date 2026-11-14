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
import { planOutput, pathKey } from './paths.js';
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

// JPEG has no alpha, and mozjpeg simply drops it, so a transparent pixel showed
// whatever colour happened to sit under it. Blend onto white, as the app does.
function flattenOnWhite(data) {
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i];
    if (a === 255) continue;
    const k = 255 - a;
    data[i - 3] = Math.round((data[i - 3] * a + 255 * k) / 255);
    data[i - 2] = Math.round((data[i - 2] * a + 255 * k) / 255);
    data[i - 1] = Math.round((data[i - 1] * a + 255 * k) / 255);
    data[i] = 255;
  }
}

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
    flattenOnWhite(upright.data);
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
    if (!fs.existsSync(input)) throw new UsageError(`No such file: ${input}`);
    walk(input);
  }
  return { files, skipped };
}

/* --- interface ----------------------------------------------------------- */

/*
 * Every option, once. --help is printed from this and --describe is built from
 * it, so the two cannot drift apart (CONTRACT.md section 3). -q is quality here,
 * as it always has been: a renamed flag breaks somebody's script.
 */
const OPTIONS = [
  { flags: ['-f', '--format'], name: 'format', metavar: 'jpeg|png', type: 'string', values: ['jpeg', 'png'], default: 'jpeg', help: 'what to write' },
  { flags: ['-q', '--quality'], name: 'quality', metavar: '40-100', type: 'integer', range: [40, 100], default: 85, help: 'jpeg quality, the app\'s default' },
  { flags: ['-s', '--size'], name: 'size', metavar: 'pixels', type: 'integer', default: 0, help: 'shrink so the long edge is at most this. 0 keeps the size' },
  { flags: ['-o', '--out', '--output'], name: 'output', metavar: 'dir', type: 'path', default: null, help: 'the folder to write into. default: beside each original' },
  { flags: ['--strip'], name: 'strip', type: 'boolean', help: 'drop the metadata (date, camera, location)' },
  { flags: ['--best'], name: 'best', type: 'boolean', help: 'full colour resolution, slower, for keepers' },
  { flags: ['--overwrite'], name: 'overwrite', type: 'boolean', help: 'replace this tool\'s own earlier output instead of renaming. Never an original' },
  { flags: ['--dry-run'], name: 'dry-run', type: 'boolean', help: 'say what would be written, and write nothing' },
  { flags: ['--json'], name: 'json', type: 'boolean', help: 'one JSON line per file, then a done line' },
  { flags: ['--quiet'], name: 'quiet', type: 'boolean', help: 'say nothing but errors' },
  { flags: ['-h', '--help'], name: 'help', type: 'boolean', help: 'this, and nothing else' },
  { flags: ['-V', '--version'], name: 'version', type: 'boolean', help: 'the version number' },
  { flags: ['--describe'], name: 'describe', type: 'boolean', help: 'what this command line accepts, as JSON' },
];

const EXIT = [
  { code: 0, meaning: 'Done: everything converted, or skipped on purpose.' },
  { code: 1, meaning: 'Failed. Nothing was converted.' },
  { code: 2, meaning: 'Usage: a bad option or value, or no input. Nothing was started.' },
  { code: 3, meaning: 'Partly done: some files converted and some failed.' },
  { code: 129, meaning: 'Stopped by a hang-up. No half-written file is left.' },
  { code: 130, meaning: 'Stopped with Ctrl-C. No half-written file is left.' },
  { code: 143, meaning: 'Stopped by a terminate signal. No half-written file is left.' },
];

function usage() {
  const opts = OPTIONS.map((o) => {
    const left = `  ${o.flags.length === 1 && o.flags[0].startsWith('--') ? '    ' : ''}${o.flags.join(', ')}${o.metavar ? ` <${o.metavar}>` : ''}`;
    return `${left.padEnd(30)} ${o.help}${o.default !== undefined && o.default !== null && o.type !== 'boolean' ? `. default: ${o.default}` : ''}`;
  }).join('\n');
  return `Just JPEG ${VERSION}
Converts HEIC photos (and HEIF, AVIF, JPEG, PNG, TIFF, WEBP) to JPEG or PNG.

  justjpeg <files or folders> [options]
  cat IMG_0123.heic | justjpeg > IMG_0123.jpg

Options
${opts}

Exit status: 0 done, 1 failed, 2 usage, 3 some files failed.

No camera RAW here. The app converts RAW (and GIF and BMP); this does not,
because the RAW decoder needs a browser to run in. Everything else matches
the app: originals are only ever read, dates and cameras survive, and
nothing is uploaded anywhere.`;
}

function describe() {
  return {
    schema: 'ponderdev.cli-describe/1',
    name: 'justjpeg',
    product: 'Just JPEG',
    version: VERSION,
    licence: require_('../package.json').license,
    command: 'justjpeg',
    job: 'Convert HEIC and other photos to JPEG or PNG, keeping dates and cameras.',
    network: false,
    accepts: { mediaTypes: ['image/heic', 'image/heif', 'image/avif', 'image/jpeg', 'image/png', 'image/tiff', 'image/webp'], extensions: [...INPUT_EXTS] },
    emits: { mediaTypes: ['image/jpeg', 'image/png'], extensions: ['.jpg', '.png'] },
    arguments: [{ name: 'input', type: 'path', required: false, repeatable: true, help: 'files or folders. None reads one image from stdin' }],
    options: OPTIONS,
    result: { fields: { input: 'path', output: 'path', in: 'path', out: 'path', width: 'integer', height: 'integer', bytes: 'integer' } },
    needs: [],
    io: {
      stdin: 'one image, read when no input is named and stdin is not a terminal (gives up after 10 seconds of nothing)',
      stdout: 'the converted image when reading stdin (any --format; --json is not printed then, there is nowhere for it to go), otherwise JSON lines with --json, otherwise nothing',
      stderr: 'a line per file for people, and errors',
    },
    exitCodes: EXIT,
    guarantees: ['never writes over an original', 'writes to a temporary name and renames, so a stopped run leaves no half image', 'nothing is uploaded'],
  };
}

class UsageError extends Error {}

/*
 * JSON lines (CONTRACT.md section 4): result, skip and error lines, then a
 * done line, always. The released fields (ok, in, out, width, height, bytes)
 * are kept so a script reading them keeps working; type, input, output and the
 * done line are new.
 */
const report = {
  on: false,
  counts: { results: 0, skipped: 0, failed: 0 },
  line(obj) { if (this.on) process.stdout.write(JSON.stringify(obj) + '\n'); },
  result(obj) { this.counts.results++; this.line({ type: 'result', ...obj }); },
  skip(obj) { this.counts.skipped++; this.line({ type: 'skip', ok: true, ...obj }); },
  error(obj) { this.counts.failed++; this.line({ type: 'error', ok: false, ...obj }); },
  done(exit) { this.line({ type: 'done', ok: exit === 0, ...this.counts, exit }); },
};

// The temporary file being written, removed if a signal stops the run.
let writing = null;

function parseArgs(argv) {
  const o = { inputs: [], format: 'jpeg', quality: 85, size: 0, out: null,
              keepMetadata: true, best: false, onExisting: 'rename',
              json: false, quiet: false, dryRun: false };
  // An option at the end with no value used to fall through as undefined, so
  // `-o` alone quietly wrote beside the originals, and `-o --json` made a
  // folder called --json. Refuse both.
  const value = (i, name) => {
    if (argv[i] === undefined || argv[i].startsWith('--')) throw new UsageError(`${name} needs a value`);
    return argv[i];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-f' || a === '--format') o.format = value(++i, '--format');
    else if (a === '-q' || a === '--quality') o.quality = Number(value(++i, '--quality'));
    else if (a === '-s' || a === '--size') o.size = Number(value(++i, '--size'));
    else if (a === '-o' || a === '--out' || a === '--output') o.out = value(++i, '--out');
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--strip') o.keepMetadata = false;
    else if (a === '--best') o.best = true;
    else if (a === '--overwrite') o.onExisting = 'overwrite';
    else if (a === '--json') o.json = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a.startsWith('-') && a !== '-') throw new UsageError(`Unknown option "${a}"`);
    else o.inputs.push(a);
  }
  if (!['jpeg', 'png'].includes(o.format)) throw new UsageError(`--format is jpeg or png, not "${o.format}"`);
  if (!(o.quality >= 40 && o.quality <= 100)) throw new UsageError('--quality is 40 to 100');
  // A negative size used to shrink every image to 1x1, and a word was ignored.
  if (!(Number.isInteger(o.size) && o.size >= 0)) throw new UsageError('--size is a whole number of pixels');
  return o;
}

// Reads stdin for the one-image pipe. When nobody named a file, an open pipe
// that never sends anything is almost always a harness or an agent with a
// missing argument, so give up after 10 seconds rather than wait forever.
async function readStdin() {
  const chunks = [];
  let got = false;
  const timer = setTimeout(() => {
    if (got) return;
    process.stdin.destroy();
    process.stderr.write('No input file, and nothing arrived on stdin. Name a file or folder.\n');
    report.error({ code: 'usage', message: 'No input file, and nothing arrived on stdin.' });
    report.done(2);
    process.exit(2);
  }, 10000);
  for await (const c of process.stdin) { got = true; chunks.push(c); }
  clearTimeout(timer);
  return new Uint8Array(Buffer.concat(chunks));
}

async function main(argv) {
  // Answered before anything else is looked at: a bad option beside them still
  // gets an answer, no file is opened and stdin is never read.
  if (argv.includes('-h') || argv.includes('--help')) { console.log(usage()); return 0; }
  if (argv.includes('-V') || argv.includes('--version')) { console.log(VERSION); return 0; }
  if (argv.includes('--describe')) { console.log(JSON.stringify(describe(), null, 2)); return 0; }

  report.on = argv.includes('--json');
  const opts = parseArgs(argv);

  // Piped: one image in, one image out. The image is stdout, so --json is
  // left off here: there is nowhere for it to go.
  if (!opts.inputs.length && !process.stdin.isTTY) {
    report.on = false;
    const input = await readStdin();
    // Run with nothing piped in (stdin at /dev/null, as scripts and agents
    // often have it), say how to use it rather than "not an image".
    if (!input.length) {
      report.on = argv.includes('--json');
      throw new UsageError('No input file, and nothing arrived on stdin. Name a file or folder, or justjpeg --help.');
    }
    const r = await convert(input, opts, 'stdin');
    process.stdout.write(r.bytes);
    if (!opts.quiet) process.stderr.write(`${r.width}x${r.height} ${opts.format} to stdout\n`);
    return 0;
  }
  if (!opts.inputs.length) throw new UsageError('Name a file or folder to convert. justjpeg --help says how.');

  const { files, skipped } = gather(opts.inputs);
  if (!files.length && !skipped.length) throw new UsageError('Nothing here that looks like an image');

  // Paths this run must not replace: every original in it, and every output
  // already claimed, so --overwrite only ever replaces older output.
  const taken = new Set(files.map((f) => pathKey(f)));
  let failed = 0;
  for (const file of files) {
    try {
      const bytes = new Uint8Array(fs.readFileSync(file));
      const plan = planOutput(
        { sourcePath: file, outDir: opts.out, format: opts.format, onExisting: opts.onExisting },
        fs.existsSync,
        process.platform,
        (p) => taken.has(pathKey(p)),
      );
      taken.add(pathKey(plan.path));
      if (plan.action === 'skip') {
        report.skip({ input: file, in: file, output: plan.path, reason: 'output-exists', message: `${path.basename(plan.path)} is already there` });
        if (!opts.quiet && !report.on) process.stderr.write(`skip  ${file} (output exists)\n`);
        continue;
      }
      if (opts.dryRun) {
        report.result({ ok: true, dryRun: true, input: file, in: file, output: plan.path, out: plan.path });
        if (!opts.quiet && !report.on) process.stderr.write(`would ${file} -> ${plan.path}\n`);
        continue;
      }
      const r = await convert(bytes, opts, path.basename(file));
      if (opts.out) fs.mkdirSync(opts.out, { recursive: true });
      // Write beside the target then rename, as the app does, so a run killed
      // mid-write never leaves half an image, least of all over a good one
      // that --overwrite was replacing.
      const temp = `${plan.path}.justjpeg-${process.pid}.tmp`;
      try {
        writing = temp;
        fs.writeFileSync(temp, r.bytes);
        fs.renameSync(temp, plan.path);
        writing = null;
      } catch (err) {
        writing = null;
        try { fs.unlinkSync(temp); } catch { /* nothing to clean up */ }
        throw err;
      }
      report.result({ ok: true, input: file, output: plan.path, in: file, out: plan.path, width: r.width, height: r.height, bytes: r.bytes.length });
      if (!report.on && !opts.quiet) {
        process.stderr.write(`ok    ${file} -> ${plan.path}  ${r.width}x${r.height}\n`);
      }
    } catch (err) {
      failed++;
      const msg = String(err && err.message || err);
      report.error({ code: 'failed', input: file, in: file, error: msg, message: msg });
      if (!report.on) process.stderr.write(`fail  ${msg}\n`);
    }
  }

  for (const s of skipped) {
    report.skip({ input: s, in: s, reason: 'raw', message: 'needs the app, the command line does not do RAW' });
    if (!opts.quiet && !report.on) process.stderr.write(`raw   ${s} needs the app, the command line does not do RAW\n`);
  }
  if (skipped.length && !failed && !opts.quiet) {
    process.stderr.write(`${skipped.length} RAW file${skipped.length > 1 ? 's' : ''} left alone. https://ponderdev.com/justjpeg\n`);
  }
  if (!failed) return 0;
  return report.counts.results ? 3 : 1;
}

for (const [sig, code] of [['SIGHUP', 129], ['SIGINT', 130], ['SIGTERM', 143]]) {
  process.on(sig, () => {
    if (writing) { try { fs.unlinkSync(writing); } catch { /* not there yet */ } }
    process.exit(code);
  });
}

// Set the exit code and let node exit by itself, never process.exit(): on
// macOS and Windows a write to a pipe finishes asynchronously, so exiting at
// once cut piped images off at 64KB and could drop the last --json lines.
main(process.argv.slice(2))
  .then((code) => { report.done(code); process.exitCode = code; })
  .catch((err) => {
    const usageError = err instanceof UsageError;
    const code = usageError ? 2 : 1;
    const msg = String(err && err.message || err);
    report.error({ code: usageError ? 'usage' : 'failed', message: msg });
    process.stderr.write(msg + '\n');
    report.done(code);
    process.exitCode = code;
  });
