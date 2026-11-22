#!/usr/bin/env node
// Just JPEG on the command line.
//
// The same engine as the app (src/engine.js), not a copy of it: the settings
// and their limits, which files count, where each result goes and what is
// skipped, how a picture is turned and sized, what travels into the file, the
// words for a failure or a skip. The window's main process and its conversion
// worker call that same module, and test/engine.test.mjs fails if either side
// grows a private copy of a decision again.
//
// What it cannot share is what is not a decision: the drawing (the app rotates
// and scales on a canvas; the command line has src/pixels.js and
// @jsquash/resize doing that job on raw buffers), the codecs each side loads,
// and its own file and terminal I/O.
//
// Camera RAW goes through the app's own decoder (LibRaw, in src/raw.js, the
// code the window's worker runs too). That decoder is a browser build that
// starts workers and loads its files like a web page, so src/rawshim.js gives
// it those over node's worker_threads. What the command line still leaves to
// the app: AVIF, GIF and BMP, which the browser's decoder reads.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

import { orient, flattenOnWhite } from './pixels.js';
import { isOurs } from './paths.js';
import { decodeRaw, createGate, RawTimeout } from './raw.js';
import { buildExif } from './exif.js';
import {
  sniff, extractExif, MESSAGES, labelled, decodeHeif, decodeTiff, orientationFor, profileFor,
  fitScale, fitSize, jpegOptions, finishOutput, createBatchPlanner, skipText, skipCode, tempPath, settingsProblem,
  extensionsFor, isCameraRaw, DEFAULTS,
} from './engine.js';

const require_ = createRequire(import.meta.url);
const VERSION = require_('../package.json').version;
// The family's folder intake, one copy for the app and this command line.
const kit = require_('./kit/scan.cjs');
const { scan, VERSION: KIT_VERSION } = kit;

// The kinds it converts: the engine's list for this side.
const CONVERTS = new Set(extensionsFor('cli'));

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
// One camera RAW file in memory at a time: a big one is hundreds of megabytes
// once decoded. (The command line goes file by file anyway; this keeps it so.)
const rawGate = createGate(1);
// LibRaw and the shim load only when a RAW file turns up.
const loadRaw = async () => (await import('./raw-node.js')).loadLibRawInNode();

async function decode(bytes, label) {
  const kind = sniff(bytes);

  if (kind === 'heif') {
    if (!heifLib) heifLib = require_('libheif-js');
    let image;
    try {
      image = await decodeHeif(heifLib, bytes);
    } catch (err) {
      // The libheif here reads HEIC (HEVC) but has no AV1, and node has no
      // browser decoder to lean on, so AVIF is the app's, as RAW is.
      const brand = String.fromCharCode(...bytes.subarray(8, 12));
      if (brand === 'avif' || brand === 'avis') {
        throw new Error(`${label}: looks like AVIF, which the command line does not convert. The Just JPEG app does: https://ponderdev.com/justjpeg`);
      }
      throw err;
    }
    const tiff = extractExif(bytes);
    return {
      image,
      orientation: orientationFor({ kind, backend: 'cli', tiff, bytes }),
      tiff,
      icc: profileFor({ kind, bytes }),
    };
  }

  if (kind === 'raw') {
    // TIFF-shaped files are either real camera RAW or an ordinary TIFF, which
    // LibRaw will not touch. Try RAW first, then TIFF (only for a file that is
    // not a camera RAW), as the app does. LibRaw
    // returns the picture upright already, so nothing is turned again.
    let rawError;
    try {
      const out = await rawGate(() => decodeRaw(bytes, { loadLibRaw: loadRaw }));
      const tiff = extractExif(bytes) || (out.meta ? buildExif(out.meta) : null);
      return { image: out, orientation: orientationFor({ kind, backend: 'cli', tiff, bytes }), tiff, icc: profileFor({ kind, bytes }) };
    } catch (err) {
      rawError = err;
    }
    // A camera RAW that LibRaw cannot read is damaged: the TIFF reader would
    // find only its small embedded preview, so it fails here instead.
    if (isCameraRaw(bytes, label)) {
      throw new Error(labelled(label, rawError instanceof RawTimeout ? rawError.message : MESSAGES.rawDamaged));
    }
    try {
      const { image, orientation, icc } = decodeTiff(require_('utif'), bytes);
      return { image, orientation, tiff: extractExif(bytes), icc };
    } catch (tiffError) {
      throw new Error(`${label}: ${rawError.message} (also tried TIFF: ${tiffError.message})`);
    }
  }

  if (kind === 'native') {
    const b = bytes;
    if (b[0] === 0xff && b[1] === 0xd8) {
      const image = await (await codec('jpeg-decode'))(bytes);
      // The app leans on the browser to apply EXIF rotation to JPEGs. There
      // is no browser here, so the engine reads it for us to apply.
      const tiff = extractExif(bytes);
      return { image, orientation: orientationFor({ kind, backend: 'cli', tiff }), tiff, icc: null };
    }
    if (b[0] === 0x89 && b[1] === 0x50) {
      return { image: await (await codec('png-decode'))(bytes), orientation: 1, tiff: null, icc: null };
    }
    if (String.fromCharCode(b[0], b[1], b[2], b[3]) === 'RIFF') {
      return { image: await (await codec('webp-decode'))(bytes), orientation: 1, tiff: null, icc: null };
    }
    throw new Error(`${label}: GIF and BMP need the app; the command line reads HEIC, JPEG, PNG, TIFF and WEBP`);
  }

  throw new Error(labelled(label, MESSAGES.unknown));
}

/* --- the conversion ----------------------------------------------------- */

async function convert(bytes, opts, label) {
  const { image, orientation, tiff, icc } = await decode(bytes, label);

  let upright = orient(image, orientation);

  if (fitScale(upright.width, upright.height, 1, opts.size) < 1) {
    const { width, height } = fitSize(upright.width, upright.height, 1, opts.size);
    upright = await (await codec('resize'))(
      { data: upright.data, width: upright.width, height: upright.height },
      { width, height },
    );
  }

  let out;
  if (opts.format === 'png') {
    out = new Uint8Array(await (await codec('png-encode'))(upright));
  } else {
    // JPEG has no alpha: blend onto white, as the app does.
    flattenOnWhite(upright.data);
    out = new Uint8Array(await (await codec('jpeg-encode'))(upright, jpegOptions({ quality: opts.quality, best: opts.best })));
  }

  // Details, profile and Just JPEG's mark go on exactly as in the app.
  out = finishOutput({ format: opts.format, bytes: out, tiff, icc, keepMetadata: opts.keepMetadata, width: upright.width, height: upright.height });

  return { bytes: out, width: upright.width, height: upright.height };
}

/* --- files and folders --------------------------------------------------- */

// What a folder holds comes from the kit's intake, as in the app: only the
// kinds this tool takes, subfolders too, hidden files and its own results
// folders ("Holiday (JPEG)") passed over. A file named on its own must be a
// kind it takes (RAW is named so it can be told about). Each file keeps the
// folder it was found in (from), which decides where its result goes.
async function gather(inputs) {
  const found = await scan(inputs, { extensions: extensionsFor('cli'), anyNamed: false, word: 'JPEG' });
  if (found.missing.length) throw new UsageError(`No such file: ${found.missing[0]}`);
  return { files: found.files };
}

// A file's first bytes, which is all the plan needs to know what it is.
function readHead(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(64);
    return new Uint8Array(buf.subarray(0, fs.readSync(fd, buf, 0, 64, 0)));
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/* --- interface ----------------------------------------------------------- */

/*
 * Every option, once. --help is printed from this and --describe is built from
 * it, so the two cannot drift apart (CONTRACT.md section 3). -q is quality here,
 * as it always has been: a renamed flag breaks somebody's script.
 */
const OPTIONS = [
  { flags: ['-f', '--format'], name: 'format', metavar: 'jpeg|png', type: 'string', values: ['jpeg', 'png'], default: 'jpeg', help: 'what to write' },
  { flags: ['-q', '--quality'], name: 'quality', metavar: '40-100', type: 'integer', range: [40, 100], default: DEFAULTS.quality, help: 'jpeg quality, the app\'s default' },
  { flags: ['-s', '--size'], name: 'size', metavar: 'pixels', type: 'integer', default: 0, help: 'shrink so the long edge is at most this. 0 keeps the size' },
  { flags: ['-o', '--out', '--output'], name: 'output', metavar: 'dir', type: 'path', default: null, help: 'the folder to write into (a folder\'s own subfolders are mirrored inside it). default: beside each file named on its own; a folder\'s results go in a new "folder (JPEG)" beside it' },
  { flags: ['--beside'], name: 'beside', type: 'boolean', help: 'with a folder, save each result beside its original instead of in a new "folder (JPEG)"' },
  { flags: ['--strip'], name: 'strip', type: 'boolean', help: 'drop the metadata (date, camera, location)' },
  { flags: ['--best'], name: 'best', type: 'boolean', help: 'full colour resolution, slower, for keepers' },
  { flags: ['--overwrite'], name: 'overwrite', type: 'boolean', help: 'replace a file already there with the same name instead of renaming, but only a file Just JPEG made (it marks every picture it writes). Never an original, never a real photo of yours, and never a file among the ones being converted: those are renamed, "name 2.jpg", as before' },
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
Converts HEIC photos and camera RAW files (and HEIF, JPEG, PNG, TIFF, WEBP) to JPEG or PNG.

  justjpeg <files or folders> [options]
  cat IMG_0123.heic | justjpeg > IMG_0123.jpg

Options
${opts}

Exit status: 0 done, 1 failed, 2 usage, 3 some files failed.

A file that looks like an earlier result (photo.jpg beside photo.heic, or
photo 2.jpg) is left alone and reported as a skip. An edited IMG_0001.JPG kept
beside IMG_0001.HEIC looks the same: name it on its own to convert it. JPEG
has no see-through, so transparent areas turn white (use -f png to keep them).

Camera RAW (DNG, CR2, CR3, NEF, ARW, RAF, ORF, RW2 and the rest) goes through
the same decoder as the app, one file at a time; a large one takes a few
seconds and a lot of memory. AVIF, GIF and BMP need the app. Everything else
matches the app: originals are only ever read, dates and cameras survive, and
nothing is uploaded anywhere.`;
}

function describe() {
  return {
    schema: 'ponderdev.cli-describe/1',
    name: 'justjpeg',
    product: 'Just JPEG',
    version: VERSION,
    licence: require_('../package.json').license,
    // The kit the app is built with (decided 2026-11-20), from the kit's own copy.
    kit: KIT_VERSION,
    command: 'justjpeg',
    job: 'Convert HEIC, camera RAW and other photos to JPEG or PNG, keeping dates and cameras.',
    network: false,
    accepts: { mediaTypes: ['image/heic', 'image/heif', 'image/jpeg', 'image/png', 'image/tiff', 'image/webp', 'image/x-adobe-dng', 'image/x-canon-cr2', 'image/x-canon-cr3', 'image/x-nikon-nef', 'image/x-sony-arw', 'image/x-fuji-raf', 'image/x-olympus-orf', 'image/x-panasonic-rw2'], extensions: [...CONVERTS] },
    output: 'name.jpg (or .png) beside a file named on its own; a folder\'s results in a new folder beside it, "folder (JPEG)" (then "folder (JPEG) 2"), subfolders mirrored, names kept, the folder itself untouched, and complete: a photo already in the output format is copied in as it is (a result line with copied: true); --beside puts every result beside its original; -o writes into that folder instead; a taken name becomes "name 2.jpg", never over an existing file (--overwrite replaces only a file Just JPEG itself made: every picture it writes carries a small mark, a JPEG comment or PNG text "Just JPEG"; copied-in photos carry none)',
    emits: { mediaTypes: ['image/jpeg', 'image/png'], extensions: ['.jpg', '.png'] },
    arguments: [{ name: 'input', type: 'path', required: false, repeatable: true, help: 'files or folders. None reads one image from stdin' }],
    options: OPTIONS,
    result: { fields: { input: 'path', output: 'path', in: 'path', out: 'path', copied: 'boolean', width: 'integer', height: 'integer', bytes: 'integer' } },
    needs: [],
    io: {
      stdin: 'one image, read when no input is named and stdin is not a terminal (gives up after 10 seconds of nothing)',
      stdout: 'the converted image when reading stdin (any --format; --json is not printed then, there is nowhere for it to go), otherwise JSON lines with --json, otherwise nothing',
      stderr: 'a line per file for people, and errors',
    },
    exitCodes: EXIT,
    skips: {
      'earlier-output': 'looks like this tool\'s own earlier result: the same name as another photo in the batch in another format, or that name with " 2", " 3" after it. Only beside the originals. An edited IMG_0001.JPG beside IMG_0001.HEIC is skipped too; name it on its own to convert it',
      original: 'the result would land on the original itself',
      'output-exists': 'the name is taken',
    },
    notes: ['camera RAW is decoded by the same LibRaw as the app, one file at a time, with a time limit on each; the picture comes out upright and the camera, lens, exposure and date are kept (no location)', 'JPEG has no see-through: transparent areas of a PNG, WebP or TIFF turn white. -f png keeps them', 'a TIFF\'s own orientation and colour profile are applied and carried'],
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
// A results folder made for the file being written ([dir, folder]), removed on a
// signal or a failed save if it is still empty.
let madeFor = null;
function removeIfEmpty([dir, folder]) {
  for (; dir.startsWith(folder); dir = path.dirname(dir)) {
    try { fs.rmdirSync(dir); } catch { break; }
    if (dir === folder) break;
  }
}

function parseArgs(argv) {
  const o = { inputs: [], format: DEFAULTS.format, quality: DEFAULTS.quality, size: DEFAULTS.size, out: null,
              keepMetadata: true, best: false, onExisting: 'rename', beside: false,
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
    else if (a === '--beside') o.beside = true;
    else if (a === '--strip') o.keepMetadata = false;
    else if (a === '--best') o.best = true;
    else if (a === '--overwrite') o.onExisting = 'overwrite';
    else if (a === '--json') o.json = true;
    else if (a === '--quiet') o.quiet = true;
    else if (a.startsWith('-') && a !== '-') throw new UsageError(`Unknown option "${a}"`);
    else o.inputs.push(a);
  }
  const problem = settingsProblem(o);
  if (problem) throw new UsageError(problem);
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

  const { files: found } = await gather(opts.inputs);
  const files = found.map((f) => f.path);
  if (!files.length) throw new UsageError('Nothing here that looks like an image');

  // The plan is the engine's, the same one the window runs: where each result
  // goes, what is left alone, what is never replaced.
  const planner = createBatchPlanner({
    path,
    platform: process.platform,
    files: found,
    settings: { format: opts.format, onExisting: opts.onExisting, outDir: opts.out, beside: opts.beside },
    kit,
    exists: fs.existsSync,
    ours: isOurs,
  });
  const saved = new Set();
  let failed = 0;
  let copiedCount = 0;
  for (const file of files) {
    try {
      const plan = await planner.plan(file, () => readHead(file));
      if (plan.action === 'skip' && plan.unreadable) throw new Error(labelled(path.basename(file), MESSAGES.unknown));
      if (plan.action === 'skip') {
        const why = skipText(plan, 'cli');
        report.skip({ input: file, in: file, ...(plan.path ? { output: plan.path } : {}), reason: skipCode(plan), ...(plan.from ? { from: plan.from } : {}), message: why });
        if (!opts.quiet && !report.on) process.stderr.write(`skip  ${file} (${why})\n`);
        continue;
      }
      // In a folder's results folder a photo already in the output format is
      // copied in as it is, so the folder is complete (the plan says so).
      const copy = plan.copy;
      if (opts.dryRun) {
        report.result({ ok: true, dryRun: true, input: file, in: file, output: plan.path, out: plan.path, ...(copy ? { copied: true } : {}) });
        if (!opts.quiet && !report.on) process.stderr.write(`${copy ? 'would copy' : 'would'} ${file} -> ${plan.path}\n`);
        continue;
      }
      const bytes = new Uint8Array(fs.readFileSync(file));
      const r = copy ? { bytes, copied: true } : await convert(bytes, opts, path.basename(file));
      fs.mkdirSync(path.dirname(plan.path), { recursive: true });
      if (plan.folder) madeFor = [path.dirname(plan.path), plan.folder];
      // Write beside the target then rename, as the app does, so a run killed
      // mid-write never leaves half an image, least of all over a good one
      // that --overwrite was replacing.
      const temp = tempPath(plan.path, process.pid);
      try {
        writing = temp;
        fs.writeFileSync(temp, r.bytes);
        fs.renameSync(temp, plan.path);
        writing = null;
      } catch (err) {
        writing = null;
        try { fs.unlinkSync(temp); } catch { /* nothing to clean up */ }
        if (madeFor) removeIfEmpty(madeFor);
        throw err;
      }
      madeFor = null;
      if (plan.folder) saved.add(plan.folder);
      if (r.copied) {
        copiedCount++;
        report.result({ ok: true, input: file, output: plan.path, in: file, out: plan.path, copied: true, bytes: r.bytes.length });
        if (!report.on && !opts.quiet) process.stderr.write(`copy  ${file} -> ${plan.path}  (already ${opts.format === 'png' ? 'PNG' : 'JPEG'}, copied as it is)\n`);
      } else {
        report.result({ ok: true, input: file, output: plan.path, in: file, out: plan.path, width: r.width, height: r.height, bytes: r.bytes.length });
        if (!report.on && !opts.quiet) {
          process.stderr.write(`ok    ${file} -> ${plan.path}  ${r.width}x${r.height}\n`);
        }
      }
    } catch (err) {
      failed++;
      const msg = String(err && err.message || err);
      report.error({ code: 'failed', input: file, in: file, error: msg, message: msg });
      if (!report.on) process.stderr.write(`fail  ${msg}\n`);
    }
  }

  if (saved.size && !opts.quiet && !report.on) process.stderr.write(`Saved in ${[...saved].join(', ')}${copiedCount ? ` (${copiedCount} already ${opts.format === 'png' ? 'PNG' : 'JPEG'}, copied as they are)` : ''}\n`);
  if (!failed) return 0;
  return report.counts.results ? 3 : 1;
}

for (const [sig, code] of [['SIGHUP', 129], ['SIGINT', 130], ['SIGTERM', 143]]) {
  process.on(sig, () => {
    if (writing) { try { fs.unlinkSync(writing); } catch { /* not there yet */ } }
    if (madeFor) removeIfEmpty(madeFor);
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
