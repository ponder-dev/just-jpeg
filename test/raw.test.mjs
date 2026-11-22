// Camera RAW on the command line.
//
//   node test/raw.test.mjs
//
// The command line decodes RAW with the app's own decoder (src/raw.js over
// LibRaw), loaded in node through the shim in src/rawshim.js. These tests run
// the real binary on real files: sample.dng (fetched, not committed) and one
// file per maker from raw.pixls.us (CC0; test/raw-fixtures.mjs). A file that
// has not been downloaded is skipped here, and fails the run when CI is set,
// as in the self-test: run scripts/fetch-fixtures.mjs.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { decodeRaw, createGate, RawTimeout } from '../src/raw.js';
import { loadLibRawInNode } from '../src/raw-node.js';
import { extractExif } from '../src/exif.js';
import { RAW_FIXTURES } from './raw-fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'src', 'cli.mjs');
const FIX = path.join(here, 'fixtures');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'justjpeg-raw-'));
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));

/** A fixture path, or a skip (a failure in CI) when it was not downloaded. */
function have(t, file) {
  const p = path.join(FIX, file);
  if (fs.existsSync(p)) return p;
  if (process.env.CI) assert.fail(`${file} is missing: run scripts/fetch-fixtures.mjs`);
  t.skip(`${file} not downloaded, run scripts/fetch-fixtures.mjs`);
  return null;
}

const cli = (args, opts = {}) =>
  spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 170000, ...opts });

/** Width and height from a JPEG's start-of-frame marker. */
function jpegSize(b) {
  assert.ok(b[0] === 0xff && b[1] === 0xd8, 'a JPEG');
  for (let p = 2; p + 9 < b.length;) {
    if (b[p] !== 0xff) { p++; continue; }
    const m = b[p + 1];
    if (m === 0xc0 || m === 0xc2) return { width: (b[p + 7] << 8) | b[p + 8], height: (b[p + 5] << 8) | b[p + 6] };
    p += 2 + ((b[p + 2] << 8) | b[p + 3]);
  }
  assert.fail('no frame header');
}

const decodeInNode = (file) => decodeRaw(new Uint8Array(fs.readFileSync(file)), { loadLibRaw: loadLibRawInNode });

test('the command line converts sample.dng to a JPEG of the camera frame, with the camera details', (t) => {
  const src = have(t, 'sample.dng');
  if (!src) return;
  const copy = path.join(dir, 'a.dng');
  fs.copyFileSync(src, copy);
  const r = cli([copy, '--json']);
  assert.equal(r.status, 0, r.stderr);
  const out = fs.readFileSync(path.join(dir, 'a.jpg'));
  assert.deepEqual(jpegSize(out), { width: 3960, height: 2640 });
  const tiff = extractExif(out);
  assert.ok(tiff, 'EXIF carried');
  const text = Buffer.from(tiff).toString('latin1');
  assert.ok(text.includes('Canon') && text.includes('EOS 5D Mark III'), 'make and model carried, as the app does');
  assert.ok(text.includes('2017:01:05'), 'date carried');
  assert.ok(fs.existsSync(copy) && fs.readFileSync(copy).equals(fs.readFileSync(src)), 'original untouched');
});

test('--strip leaves no EXIF on a RAW result', (t) => {
  const src = have(t, 'sample.dng');
  if (!src) return;
  const copy = path.join(dir, 's.dng');
  fs.copyFileSync(src, copy);
  assert.equal(cli([copy, '--strip', '--quiet']).status, 0);
  assert.equal(extractExif(fs.readFileSync(path.join(dir, 's.jpg'))), null);
});

test('the command line and the shared decoder give the same pixels as the app path, which is the same module', async (t) => {
  const src = have(t, 'sample.dng');
  if (!src) return;
  // The app's conversion worker calls decodeRaw from src/raw.js and nothing
  // else; the self-test (test/selftest.js) decodes the same file in the window
  // with it and compares the pixels to test/raw-hash.mjs under the app's own
  // runtime. Here: the worker has no private copy, and the command line's
  // pixels are the shared module's pixels, orientation untouched.
  const worker = fs.readFileSync(path.join(here, '..', 'src', 'renderer', 'convert.worker.js'), 'utf8');
  assert.match(worker, /import \{ decodeRaw as decodeRawShared, RawTimeout \} from '\.\.\/raw\.js'/);
  assert.ok(!/imageData\(|\.metadata\(|BYTES_PER_ELEMENT|camera_make/.test(worker), 'no RAW decoding left in the worker');
  // The app hands the worker the file's name, so a damaged RAW is known by its extension too.
  const app = fs.readFileSync(path.join(here, '..', 'src', 'renderer', 'app.js'), 'utf8');
  assert.match(app, /name: file\.name,/);
  assert.match(worker, /if \(isCameraRaw\(input, name\)\)/);
  const px = await decodeInNode(src);
  assert.equal(px.data.length, px.width * px.height * 4);
  const png = path.join(dir, 'p.png');
  const copy = path.join(dir, 'p.dng');
  fs.copyFileSync(src, copy);
  assert.equal(cli([copy, '-f', 'png', '-o', dir, '--quiet']).status, 0);
  const { default: decodePng } = await import('@jsquash/png/decode.js');
  // The PNG is lossless, so its pixels are the shared decode, opaque.
  const wasm = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.resolve('@jsquash/png/package.json'))), 'codec/pkg/squoosh_png_bg.wasm'));
  const { init } = await import('@jsquash/png/decode.js');
  await init(await WebAssembly.compile(wasm));
  const img = await decodePng(fs.readFileSync(png).buffer.slice(0));
  assert.equal(img.width, px.width);
  assert.equal(img.height, px.height);
  const a = crypto.createHash('sha256').update(img.data).digest('hex');
  const b = crypto.createHash('sha256').update(px.data).digest('hex');
  assert.equal(a, b, 'same pixels');
});

for (const f of RAW_FIXTURES) {
  test(`${f.file}: one JPEG of ${f.width}x${f.height}${f.flip >= 5 ? ', portrait stays portrait (flip ' + f.flip + ')' : ''}`, (t) => {
    const src = have(t, `raw/${f.file}`);
    if (!src) return;
    const copy = path.join(dir, f.file);
    fs.copyFileSync(src, copy);
    const r = cli([copy, '--json']);
    assert.equal(r.status, 0, r.stderr);
    const out = fs.readFileSync(copy.replace(/\.[^.]+$/, '.jpg'));
    const size = jpegSize(out);
    assert.deepEqual(size, { width: f.width, height: f.height });
    if (f.flip >= 5) assert.ok(size.height > size.width, 'portrait, not turned a second time');
    assert.ok(out.length > 20000, 'a real picture');
  });
}

test('a corrupt RAW fails with a plain message, exit 1, and writes nothing', () => {
  const bad = path.join(dir, 'broken.dng');
  const b = Buffer.alloc(4096, 7);
  Buffer.from([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0]).copy(b);
  fs.writeFileSync(bad, b);
  const r = cli([bad]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /broken\.dng/);
  assert.match(r.stderr, /this RAW file is damaged or incomplete/);
  assert.ok(!fs.existsSync(path.join(dir, 'broken.jpg')));
});

test('a RAW extension on something that is not an image is an unrecognized file, not a hang', () => {
  const bad = path.join(dir, 'junk.nef');
  fs.writeFileSync(bad, crypto.randomBytes(300));
  const r = cli([bad]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not an image file we recognize/i);
});

test('the time limit fires on a decoder that never answers, and the decoder is disposed', async () => {
  let disposed = false;
  class Hangs {
    open() { return new Promise(() => {}); }
    dispose() { disposed = true; }
  }
  const started = Date.now();
  await assert.rejects(
    decodeRaw(new Uint8Array(8), { loadLibRaw: async () => Hangs, timeoutMs: 200 }),
    (err) => err instanceof RawTimeout && /did not answer in 0 seconds|did not answer in \d+ seconds/.test(err.message) && /stopped/.test(err.message),
  );
  assert.ok(Date.now() - started < 5000);
  assert.ok(disposed, 'disposed after the time limit');
});

test('the decoder is disposed after a good decode and after a failed one', async () => {
  const log = [];
  class Fine {
    async open() {}
    async imageData() { return { width: 1, height: 1, data: new Uint16Array([65535, 0, 32768]) }; }
    async metadata() { return { camera_make: 'X', timestamp: new Date(0) }; }
    dispose() { log.push('disposed'); }
  }
  class Fails {
    async open() { throw new Error('nope'); }
    dispose() { log.push('disposed'); }
  }
  const ok = await decodeRaw(new Uint8Array(4), { loadLibRaw: async () => Fine });
  assert.deepEqual([...ok.data], [255, 0, 128, 255], '16-bit to 8-bit, opaque');
  assert.equal(ok.meta.make, 'X');
  await assert.rejects(decodeRaw(new Uint8Array(4), { loadLibRaw: async () => Fails }), /nope/);
  assert.deepEqual(log, ['disposed', 'disposed']);
});

test('the gate runs at most the allowed number of jobs at once', async () => {
  const gate = createGate(1);
  let active = 0;
  let most = 0;
  const job = async () => { active++; most = Math.max(most, active); await new Promise((r) => setTimeout(r, 20)); active--; };
  await Promise.all([gate(job), gate(job), gate(job), gate(job)]);
  assert.equal(most, 1);
});

test('the shim reads file: URLs with spaces and percent signs in the path', async () => {
  const { makeFetch, FileXMLHttpRequest } = await import('../src/rawshim.js');
  const odd = path.join(dir, 'a folder', '100% odd');
  fs.mkdirSync(odd, { recursive: true });
  const file = path.join(odd, 'x.wasm');
  fs.writeFileSync(file, Buffer.from([0, 0x61, 0x73, 0x6d]));
  const url = new URL(`file://${file.startsWith('/') ? '' : '/'}${file.split(path.sep).map(encodeURIComponent).join('/')}`);
  const res = await makeFetch(async () => { throw new Error('not file'); })(url);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/wasm');
  assert.equal(Buffer.from(await res.arrayBuffer()).length, 4);
  const x = new FileXMLHttpRequest();
  x.open('GET', url.href);
  x.send();
  assert.equal(x.status, 200);
  assert.equal(x.response.byteLength, 4);
  const missing = await makeFetch(async () => { throw new Error('not file'); })(new URL('file://' + path.join(odd, 'nope')));
  assert.equal(missing.status, 404);
});

test('a folder of RAW files with a HEIC beside them converts all, one at a time', (t) => {
  const src = have(t, 'sample.dng');
  if (!src) return;
  const d = path.join(dir, 'mixed');
  fs.mkdirSync(d);
  fs.copyFileSync(src, path.join(d, 'one.dng'));
  fs.copyFileSync(src, path.join(d, 'two.DNG'));
  fs.copyFileSync(path.join(FIX, 'sample.heic'), path.join(d, 'three.heic'));
  const r = cli([d, '--json']);
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.filter((l) => l.type === 'result').length, 3);
  assert.equal(lines.find((l) => l.type === 'done').exit, 0);
});

/* --- a damaged RAW fails, and never gives its embedded preview (decided 2026-11-21) --- */

/** The first half of sample.dng: LibRaw cannot read it, but the TIFF reader would find the small preview. */
function truncatedDng(t, name) {
  const src = have(t, 'sample.dng');
  if (!src) return null;
  const whole = fs.readFileSync(src);
  const p = path.join(dir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, whole.subarray(0, Math.floor(whole.length / 2)));
  return p;
}

test('a truncated DNG fails with a plain message, exit 1, and writes nothing (no embedded preview)', (t) => {
  const p = truncatedDng(t, 'cut/half.dng');
  if (!p) return;
  const r = cli([p]);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /half\.dng: this RAW file is damaged or incomplete, so it was not converted/);
  assert.deepEqual(fs.readdirSync(path.dirname(p)), ['half.dng'], 'no JPEG beside it');
});

test('a truncated DNG named .tif still fails: the bytes say DNG', (t) => {
  const p = truncatedDng(t, 'cut-tif/half.tif');
  if (!p) return;
  const r = cli([p]);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stderr, /damaged or incomplete/);
  assert.deepEqual(fs.readdirSync(path.dirname(p)), ['half.tif']);
});

test('in a folder run a truncated DNG is listed as failed and the others carry on', (t) => {
  const p = truncatedDng(t, 'cut-folder/half.dng');
  if (!p) return;
  const d = path.dirname(p);
  fs.copyFileSync(path.join(FIX, 'sample.heic'), path.join(d, 'good.heic'));
  const r = cli([d, '--json']);
  const lines = r.stdout.trim().split('\n').map((l) => JSON.parse(l));
  const failed = lines.filter((l) => l.type === 'error');
  assert.equal(failed.length, 1);
  assert.match(failed[0].error, /half\.dng: this RAW file is damaged or incomplete/);
  assert.equal(lines.filter((l) => l.type === 'result').length, 1, 'the HEIC converted');
  const done = lines.find((l) => l.type === 'done');
  assert.equal(done.failed, 1);
  assert.notEqual(r.status, 0);
  assert.equal(done.exit, r.status);
  assert.deepEqual(fs.readdirSync(`${d} (JPEG)`), ['good.jpg'], 'only the good one came out');
});
