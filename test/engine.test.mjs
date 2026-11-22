// The one engine the window and the command line both run (tools-72).
//
//   node test/engine.test.mjs
//
// Every decision either of them makes lives in src/engine.js: the settings
// rules, which files count, where each result goes and what is skipped, how a
// picture is turned, how big it comes out, what travels into the file, and the
// words used for failures and skips. The window's main process, the conversion
// worker and cli.mjs keep only their own pixels and their own I/O.
//
// Two kinds of test here. The behaviour tests run one input through the engine
// the way each side calls it. The guards read the sources and fail the moment a
// side grows a private copy of a decision again, which is how the two drifted
// before: a rule fixed in one place and forgotten in the other.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import * as engine from '../src/engine.js';
import { extractExif, readOrientation } from '../src/exif.js';
import { hasMarkInBytes } from '../src/mark.js';

const require = createRequire(import.meta.url);
const kit = require('../src/kit/scan.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = (f) => fs.readFileSync(path.join(root, 'src', f), 'utf8');
const FIX = path.join(root, 'test', 'fixtures');
const P = (...parts) => path.join(...parts);

/* --- settings ---------------------------------------------------------- */

test('the defaults and limits are the engine\'s, for the slider and the flags alike', () => {
  assert.deepEqual(engine.DEFAULTS, { format: 'jpeg', quality: 85, size: 0 });
  assert.deepEqual(engine.QUALITY_RANGE, [40, 100]);
  assert.equal(engine.settingsProblem({ format: 'jpeg', quality: 85, size: 0 }), null);
  assert.equal(engine.settingsProblem({ format: 'gif', quality: 85, size: 0 }), '--format is jpeg or png, not "gif"');
  assert.equal(engine.settingsProblem({ format: 'png', quality: 39, size: 0 }), '--quality is 40 to 100');
  assert.equal(engine.settingsProblem({ format: 'png', quality: 101, size: 0 }), '--quality is 40 to 100');
  assert.equal(engine.settingsProblem({ format: 'png', quality: NaN, size: 0 }), '--quality is 40 to 100');
  assert.equal(engine.settingsProblem({ format: 'png', quality: 85, size: -1 }), '--size is a whole number of pixels');
  assert.equal(engine.settingsProblem({ format: 'png', quality: 85, size: 1.5 }), '--size is a whole number of pixels');
});

test('one list of kinds: what the window scans is what the command line scans, bar the two it cannot decode', () => {
  const app = new Set(engine.extensionsFor('app'));
  const cli = new Set(engine.extensionsFor('cli'));
  for (const e of ['.heic', '.heif', '.avci', '.avif', '.hif', '.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp', '.dng', '.cr3', '.nef', '.crw', '.x3f']) {
    assert.ok(app.has(e), `the window takes ${e}`);
    assert.ok(cli.has(e), `the command line scans ${e} (camera RAW too)`);
  }
  for (const e of ['.bmp', '.gif']) { assert.ok(app.has(e)); assert.ok(!cli.has(e), `${e} is app-only`); }
  assert.deepEqual([...app].filter((e) => !cli.has(e)).sort(), ['.bmp', '.gif']);
  assert.ok(engine.isRawExtension('.CR2') && engine.isRawExtension('.x3f') && !engine.isRawExtension('.heic'));
});

test('isCameraRaw: a camera RAW by name or by bytes, an ordinary TIFF neither', () => {
  // A little TIFF header with one directory entry of the given tag.
  const tiff = ({ le = true, magic = 42, tag = 0x0100, at8 = [0, 0] } = {}) => {
    const b = new Uint8Array(32);
    const v = new DataView(b.buffer);
    b[0] = b[1] = le ? 0x49 : 0x4d;
    v.setUint16(2, magic, le);
    v.setUint32(4, 10, le);
    b[8] = at8[0]; b[9] = at8[1];
    v.setUint16(10, 1, le);
    v.setUint16(12, tag, le);
    return b;
  };
  assert.equal(engine.isCameraRaw(tiff(), 'scan.tif'), false, 'an ordinary TIFF');
  assert.equal(engine.isCameraRaw(tiff({ le: false }), ''), false, 'big-endian too');
  assert.equal(engine.isCameraRaw(tiff(), 'IMG_1.NEF'), true, 'by its name');
  assert.equal(engine.isCameraRaw(tiff({ tag: 0xc612 }), 'x.tif'), true, 'DNGVersion, whatever the name');
  assert.equal(engine.isCameraRaw(tiff({ tag: 0xc612, le: false }), ''), true, 'DNGVersion, big-endian');
  assert.equal(engine.isCameraRaw(tiff({ at8: [0x43, 0x52] }), ''), true, 'CR2 mark');
  assert.equal(engine.isCameraRaw(tiff({ magic: 0x4f52 }), ''), true, 'ORF magic');
  assert.equal(engine.isCameraRaw(tiff({ magic: 0x55 }), ''), true, 'RW2 magic');
  const raf = new TextEncoder().encode('FUJIFILMCCD-RAW 0201');
  assert.equal(engine.isCameraRaw(raf, ''), true, 'RAF');
  const cut = tiff(); new DataView(cut.buffer).setUint32(4, 4000, true);
  assert.equal(engine.isCameraRaw(cut, ''), false, 'a directory past the end is not read');
});

/* --- turning, size, what travels --------------------------------------- */

test('which orientation is still ours to apply, for every kind and both backends', () => {
  const tiff6 = Uint8Array.from(extractExif(fs.readFileSync(path.join(FIX, 'withexif.heic'))) || []);
  assert.equal(readOrientation(tiff6), 6, 'the fixture is stored turned');
  const o = engine.orientationFor;
  // HEIF: libheif turns by the container's own rotation; EXIF only when it has none.
  assert.equal(o({ kind: 'heif', backend: 'app', tiff: tiff6, heifTransform: true }), 1);
  assert.equal(o({ kind: 'heif', backend: 'cli', tiff: tiff6, heifTransform: true }), 1);
  assert.equal(o({ kind: 'heif', backend: 'app', tiff: tiff6, heifTransform: false }), 6);
  assert.equal(o({ kind: 'heif', backend: 'cli', tiff: tiff6, heifTransform: false }), 6);
  assert.equal(o({ kind: 'heif', backend: 'cli', tiff: null, heifTransform: false }), 1);
  // Native: the browser turns a JPEG by itself, the command line has to.
  assert.equal(o({ kind: 'native', backend: 'app', tiff: tiff6 }), 1);
  assert.equal(o({ kind: 'native', backend: 'cli', tiff: tiff6 }), 6);
  assert.equal(o({ kind: 'native', backend: 'cli', tiff: null }), 1);
  // A plain TIFF's own turn is always ours.
  assert.equal(o({ kind: 'raw', backend: 'app', tiff: null, tiffTurn: 8 }), 8);
  assert.equal(o({ kind: 'raw', backend: 'cli', tiff: null, tiffTurn: 8 }), 8);
  // Camera RAW: libraw already turned it.
  assert.equal(o({ kind: 'raw', backend: 'app', tiff: tiff6 }), 1);
});

test('the size a picture comes out, exactly as the canvas and the raw buffers both need it', () => {
  const f = engine.fitSize;
  assert.deepEqual(f(4032, 3024, 1, 0), { width: 4032, height: 3024 });
  assert.deepEqual(f(4032, 3024, 6, 0), { width: 3024, height: 4032 });
  assert.deepEqual(f(4032, 3024, 1, 1200), { width: 1200, height: 900 });
  assert.deepEqual(f(4000, 3000, 8, 2000), { width: 1500, height: 2000 });
  assert.deepEqual(f(1000, 800, 1, 4000), { width: 1000, height: 800 }, 'never enlarged');
  assert.deepEqual(f(1, 5000, 1, 100), { width: 1, height: 100 }, 'never below one pixel');
  assert.deepEqual(f(5000, 1, 1, 100), { width: 100, height: 1 });
  assert.equal(engine.swapsAxes(5) && engine.swapsAxes(8) && !engine.swapsAxes(4) && !engine.swapsAxes(1), true);
});

test('the encoder settings: --best and "highest quality" are one thing', () => {
  assert.deepEqual(engine.jpegOptions({ quality: 85, best: false }), { quality: 85, progressive: true, optimize_coding: true });
  assert.deepEqual(engine.jpegOptions({ quality: 92, best: true }), { quality: 92, auto_subsample: false, chroma_subsample: 1, progressive: true, optimize_coding: true });
});

test('what travels into the file: details with the pixel size and an upright turn, the profile, and the mark', () => {
  const jpg = new Uint8Array(fs.readFileSync(path.join(FIX, 'plain.jpg')));   // what an encoder gives: no details yet
  const tiff = extractExif(new Uint8Array(fs.readFileSync(path.join(FIX, 'withexif.jpg'))));
  assert.ok(tiff);
  const bare = engine.finishOutput({ format: 'jpeg', bytes: jpg, tiff, icc: null, keepMetadata: false, width: 10, height: 20 });
  assert.equal(extractExif(bare), null, 'stripped means stripped');
  assert.ok(hasMarkInBytes(bare), 'every picture it writes carries the mark');
  const kept = engine.finishOutput({ format: 'jpeg', bytes: jpg, tiff, icc: null, keepMetadata: true, width: 10, height: 20 });
  const got = extractExif(kept);
  assert.ok(got, 'details kept');
  assert.equal(readOrientation(got), 1, 'already upright');
  const png = new Uint8Array(fs.readFileSync(path.join(FIX, 'sample.png')));
  const marked = engine.finishOutput({ format: 'png', bytes: png, tiff, icc: null, keepMetadata: true, width: 10, height: 20 });
  assert.ok(hasMarkInBytes(marked), 'a PNG is marked too');
  assert.equal(extractExif(marked), null, 'and carries no EXIF');
});

test('the words: one wording for every failure either side can give', () => {
  assert.equal(engine.MESSAGES.unknown, 'Not an image file we recognize');
  assert.equal(engine.labelled('a.heic', engine.MESSAGES.unknown), 'a.heic: not an image file we recognize');
  assert.equal(engine.MESSAGES.noHeif, 'No image found inside this HEIC file');
  assert.equal(engine.MESSAGES.heifFailed, 'HEIC decode failed');
  assert.equal(engine.MESSAGES.tiffNone, 'No image found inside this TIFF');
  assert.equal(engine.MESSAGES.tiffEmpty, 'TIFF reports a zero-sized image');
});

/* --- the decoders both sides share, given the library to use ----------- */

test('a HEIC and a TIFF decode through the same engine code on the library each side brings', async () => {
  const libheif = require('libheif-js');
  const heic = new Uint8Array(fs.readFileSync(path.join(FIX, 'sample.heic')));
  const img = await engine.decodeHeif(libheif, heic);
  assert.equal(img.width, 4032);
  assert.equal(img.height, 3024);
  assert.equal(img.data.length, 4032 * 3024 * 4);
  await assert.rejects(() => engine.decodeHeif({ HeifDecoder: class { decode() { return []; } } }, heic), /No image found inside this HEIC file/);
  await assert.rejects(() => engine.decodeHeif({ HeifDecoder: class { decode() { return [{ get_width: () => 0, get_height: () => 5 }]; } } }, heic), /HEIC reports a zero-sized image/);
  const UTIF = require('utif');
  assert.throws(() => engine.decodeTiff(UTIF, new Uint8Array(40)));
  assert.throws(() => engine.decodeTiff({ decode: () => [] }, new Uint8Array(40)), /No image found inside this TIFF/);
});

/* --- the plan: where every file goes, once, for both ------------------- */

// A tiny in-memory disk, so the same scenario runs for the window and the
// command line without touching the real one.
function disk(files) {
  const have = new Set(files.map((f) => path.resolve(f)));
  const ours = new Set();
  return { exists: (p) => have.has(path.resolve(p)), ours: (p) => ours.has(path.resolve(p)), add: (p) => have.add(path.resolve(p)), markOurs: (p) => { have.add(path.resolve(p)); ours.add(path.resolve(p)); } };
}
const batch = (files, settings, d, extra = {}) => engine.createBatchPlanner({
  path, platform: process.platform, kit, files: files.map((f) => (typeof f === 'string' ? { path: path.resolve(f), from: null } : { ...f, path: path.resolve(f.path) })),
  settings: { format: 'jpeg', onExisting: 'rename', outDir: null, beside: false, ...settings }, exists: d.exists, ours: d.ours, ...extra,
});
const JPEG_HEAD = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const HEIC_HEAD = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);

test('beside a file named on its own: name.jpg, and " 2" when taken', async () => {
  const d = disk([P('/p', 'a.heic'), P('/p', 'a.jpg')]);
  const plan = await batch([P('/p', 'a.heic')], {}, d).plan(P('/p', 'a.heic'), () => HEIC_HEAD);
  assert.equal(plan.action, 'write');
  assert.equal(plan.path, path.resolve(P('/p', 'a 2.jpg')));
  assert.equal(plan.folder, null);
  assert.equal(plan.copy, false);
});

test('a folder\'s results go in "Holiday (JPEG)", subfolders mirrored, and a photo already JPEG is copied in', async () => {
  const from = path.resolve(P('/p', 'Holiday'));
  const files = [{ path: P(from, 'a.heic'), from }, { path: P(from, 'sub', 'b.jpg'), from }];
  const d = disk(files.map((f) => f.path));
  const planner = batch(files, {}, d);
  const a = await planner.plan(P(from, 'a.heic'), () => HEIC_HEAD);
  const b = await planner.plan(P(from, 'sub', 'b.jpg'), () => JPEG_HEAD);
  assert.equal(a.path, path.resolve(P('/p', 'Holiday (JPEG)', 'a.jpg')));
  assert.equal(a.folder, path.resolve(P('/p', 'Holiday (JPEG)')));
  assert.equal(a.copy, false);
  assert.equal(b.path, path.resolve(P('/p', 'Holiday (JPEG)', 'sub', 'b.jpg')));
  assert.equal(b.copy, true, 'the folder is complete');
  assert.ok(planner.resultsFolders.has(a.folder));
  // A file merely named .jpg that is no JPEG is not copied.
  const c = await batch(files, {}, d).plan(P(from, 'sub', 'b.jpg'), () => HEIC_HEAD);
  assert.equal(c.copy, false);
});

test('--beside and a chosen folder both beat the results folder; a chosen folder mirrors', async () => {
  const from = path.resolve(P('/p', 'Holiday'));
  const files = [{ path: P(from, 'sub', 'b.heic'), from }];
  const d = disk(files.map((f) => f.path));
  const beside = await batch(files, { beside: true }, d).plan(P(from, 'sub', 'b.heic'), () => HEIC_HEAD);
  assert.equal(beside.path, path.resolve(P(from, 'sub', 'b.jpg')));
  assert.equal(beside.folder, null);
  const out = await batch(files, { outDir: P('/o') }, d).plan(P(from, 'sub', 'b.heic'), () => HEIC_HEAD);
  assert.equal(out.path, path.resolve(P('/o', 'sub', 'b.jpg')));
  assert.equal(out.copy, false);
});

test('the same results folder for every file of a folder in a run, and a new one next run', async () => {
  const from = path.resolve(P('/p', 'H'));
  const files = [{ path: P(from, 'a.heic'), from }, { path: P(from, 'b.heic'), from }];
  const d = disk(files.map((f) => f.path));
  const one = batch(files, {}, d);
  const a = await one.plan(P(from, 'a.heic'), () => HEIC_HEAD);
  d.add(a.folder);
  const b = await one.plan(P(from, 'b.heic'), () => HEIC_HEAD);
  assert.equal(a.folder, b.folder, 'chosen once per folder per run');
  const two = batch(files, {}, d);
  assert.equal((await two.plan(P(from, 'a.heic'), () => HEIC_HEAD)).folder, path.resolve(P('/p', 'H (JPEG) 2')));
});

test('earlier results are recognised by name, numbered too, and only beside the originals', async () => {
  const names = ['photo.heic', 'photo.jpg', 'photo 2.jpg', 'photo 2 2.jpg', 'other.jpg'].map((n) => P('/p', n));
  const d = disk(names);
  const planner = batch(names, {}, d);
  const verdicts = {};
  for (const n of names) verdicts[path.basename(n)] = await planner.plan(n, () => (n.endsWith('.heic') ? HEIC_HEAD : JPEG_HEAD));
  for (const n of ['photo.jpg', 'photo 2.jpg', 'photo 2 2.jpg']) {
    assert.equal(verdicts[n].action, 'skip', n);
    assert.equal(verdicts[n].reason, 'earlier-output', n);
    assert.equal(path.basename(verdicts[n].from), 'photo.heic', n);
  }
  assert.equal(verdicts['other.jpg'].action, 'write', 'a JPEG on its own is converted (kept both: other 2.jpg)');
  assert.equal(path.basename(verdicts['other.jpg'].path), 'other 2.jpg');
  const skipping = await batch(names, { onExisting: 'skip' }, disk(names)).plan(P('/p', 'other.jpg'), () => JPEG_HEAD);
  assert.equal(skipping.reason, 'original', 'and with Skip it would land on the original');
  assert.equal(verdicts['photo.heic'].action, 'write');
  // With a chosen folder a photo.jpg beside photo.heic is just another photo.
  const out = batch(names, { outDir: P('/o') }, disk(names));
  assert.equal((await out.plan(P('/p', 'photo.jpg'), () => JPEG_HEAD)).action, 'write');
  // And in a folder's results folder.
  const from = path.resolve(P('/p', 'F'));
  const inFolder = [{ path: P(from, 'x.heic'), from }, { path: P(from, 'x.jpg'), from }];
  const f = batch(inFolder, {}, disk(inFolder.map((x) => x.path)));
  assert.equal((await f.plan(P(from, 'x.jpg'), () => JPEG_HEAD)).action, 'write');
});

test('replacing: only a picture Just JPEG made, never an original or a file in the batch', async () => {
  const d = disk([P('/p', 'a.heic'), P('/p', 'real.jpg'), P('/p', 'b.heic')]);
  d.markOurs(P('/p', 'a.jpg'));
  const planner = batch([P('/p', 'a.heic'), P('/p', 'b.heic'), P('/p', 'real.heic')], { onExisting: 'overwrite' }, d);
  const a = await planner.plan(P('/p', 'a.heic'), () => HEIC_HEAD);
  assert.equal(a.path, path.resolve(P('/p', 'a.jpg')), 'ours: replaced');
  const real = await planner.plan(P('/p', 'real.heic'), () => HEIC_HEAD);
  assert.equal(real.path, path.resolve(P('/p', 'real 2.jpg')), 'a real photo with that name is kept');
});

test('skip: says why, and a skipped file that is no image is flagged unreadable', async () => {
  const d = disk([P('/p', 'a.heic'), P('/p', 'a.jpg')]);
  const planner = batch([P('/p', 'a.heic')], { onExisting: 'skip' }, d);
  const s = await planner.plan(P('/p', 'a.heic'), () => HEIC_HEAD);
  assert.equal(s.action, 'skip');
  assert.equal(s.reason, 'exists');
  assert.equal(s.unreadable, false);
  const junk = Uint8Array.from([1, 2, 3]);
  const u = await batch([P('/p', 'a.heic')], { onExisting: 'skip' }, d).plan(P('/p', 'a.heic'), () => junk);
  assert.equal(u.unreadable, true);
});

test('two photos with one stem never claim the same name', async () => {
  const d = disk([P('/p', 'x.heic'), P('/p', 'x.tiff')]);
  const planner = batch([P('/p', 'x.heic'), P('/p', 'x.tiff')], {}, d);
  const a = await planner.plan(P('/p', 'x.heic'), () => HEIC_HEAD);
  const b = await planner.plan(P('/p', 'x.tiff'), () => HEIC_HEAD);
  assert.notEqual(a.path, b.path);
});

test('the words for a skip, in the window\'s voice and the command line\'s', () => {
  const orig = { action: 'skip', reason: 'original', path: P('/p', 'a.jpg') };
  const taken = { action: 'skip', reason: 'exists', path: P('/p', 'a.jpg') };
  const early = { action: 'skip', reason: 'earlier-output', path: null, from: P('/p', 'a.heic') };
  assert.equal(engine.skipText(orig, 'app'), 'saving a.jpg here would replace the original');
  assert.equal(engine.skipText(orig, 'cli'), 'it would replace the original');
  assert.equal(engine.skipText(taken, 'app'), 'a.jpg is already there');
  assert.equal(engine.skipText(taken, 'cli'), 'a.jpg is already there');
  assert.equal(engine.skipText(early, 'app'), 'looks like the conversion of a.heic, so it was left alone');
  assert.equal(engine.skipText(early, 'cli'), 'looks like the conversion of a.heic, so it was left alone');
  assert.equal(engine.skipCode({ reason: 'exists' }), 'output-exists');
  assert.equal(engine.skipCode({ reason: 'original' }), 'original');
  assert.equal(engine.skipCode({ reason: 'earlier-output' }), 'earlier-output');
});

test('the temporary name a result is written under before it is renamed into place', () => {
  assert.equal(engine.tempPath(P('/p', 'a.jpg'), '123'), `${P('/p', 'a.jpg')}.justjpeg-123.tmp`);
});

/* --- guards: no side keeps a private copy of a decision ------------------ */

test('the command line keeps only its pixels and its I/O', () => {
  const cli = src('cli.mjs');
  for (const gone of ['function earlierOutputs', 'function flattenOnWhite', 'function placeOf', 'const placeOf', 'const INPUT_EXTS', 'const RAW_EXTS', 'planOutput(', 'finalizeJpeg(', 'markFor(', 'setOrientation(', 'heifHasTransform(', 'iccFromHeif(', 'isInOutputFormat(', 'resultsFolder(']) {
    assert.ok(!cli.includes(gone), `cli.mjs must not hold its own ${gone}`);
  }
  assert.ok(cli.includes("from './engine.js'"), 'cli.mjs runs the engine');
  assert.ok(cli.includes('createBatchPlanner('), 'and plans through it');
  assert.ok(cli.includes('finishOutput('), 'and finishes files through it');
});

test('the window\'s main process plans through the engine, and the worker finishes through it', () => {
  const main = src('main.js');
  for (const gone of ['planOutput(', 'function outputDirFor', 'isInOutputFormat(', 'resultsFolder(', 'const INPUT_EXTENSIONS']) {
    assert.ok(!main.includes(gone), `main.js must not hold its own ${gone}`);
  }
  assert.ok(main.includes('createBatchPlanner('), 'main.js plans through the engine');
  const worker = src('renderer/convert.worker.js');
  for (const gone of ['finalizeJpeg(', 'markFor(', 'setOrientation(', 'heifHasTransform(', 'iccFromHeif(', 'readOrientation(', 'function decodeTiff', 'new lib.HeifDecoder']) {
    assert.ok(!worker.includes(gone), `the worker must not hold its own ${gone}`);
  }
  assert.ok(worker.includes("from '../engine.js'"));
  assert.ok(worker.includes('finishOutput('));
  assert.ok(src('render.js').includes('fitSize('), 'the canvas takes its size from the engine too');
  assert.ok(src('renderer/app.js').includes('skipText('), 'and the window says a skip in the engine\'s words');
});

test('the engine can run in the worker: no imports of node, none at the top', () => {
  const text = src('engine.js');
  const imports = [...text.matchAll(/^import .*? from '([^']+)'/gm)].map((m) => m[1]);
  for (const i of imports) assert.ok(i.startsWith('./'), `engine.js imports only its own siblings, not ${i}`);
  assert.ok(!/\brequire\(|process\.|node:/.test(text.replace(/\/\/.*$/gm, '')), 'no node-only names in the engine');
});

test('the bundle ships the engine inside the worker and the source tree ships it for the command line', () => {
  const yml = fs.readFileSync(path.join(root, 'electron-builder.yml'), 'utf8');
  assert.match(yml, /- src\/\*\*\/\*/, 'src/** ships (the command line, and the engine with it)');
  const bundled = path.join(root, 'app', 'renderer', 'convert.worker.js');
  if (fs.existsSync(bundled)) {
    // The bundle is minified, but a message from the engine survives in it.
    assert.ok(fs.readFileSync(bundled, 'utf8').includes('No image found inside this HEIC file'), 'the worker bundle holds the engine');
  }
});

test('a phone folder: Live Photo .MOV and .AAE sidecars are passed over by the window\'s scan too, not counted', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'justjpeg-phone-'));
  try {
    const sub = path.join(dir, 'DCIM', '100APPLE');
    fs.mkdirSync(sub, { recursive: true });
    for (const n of ['IMG_0001.HEIC', 'IMG_0001.MOV', 'IMG_0001.AAE', 'IMG_0002.HEIC', '.DS_Store', '._IMG_0002.HEIC']) fs.writeFileSync(path.join(sub, n), 'x');
    const found = await kit.scan([dir], { extensions: [...engine.extensionsFor('app')], anyNamed: false, word: 'JPEG' });
    assert.deepEqual(found.files.map((f) => f.name), ['IMG_0001.HEIC', 'IMG_0002.HEIC']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
