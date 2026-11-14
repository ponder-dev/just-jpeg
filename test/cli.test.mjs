// The command line, end to end, as a subprocess.
//
//   node test/cli.test.mjs
//
// Real fixtures, the real binary, the way a terminal would run it.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(root, 'src', 'cli.mjs');
const FIX = path.join(root, 'test', 'fixtures');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'justjpeg-cli-'));
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));

// The result lines of a --json run. Since 1.2.0 a done line follows them.
const results = (text) => text.trim().split('\n').map((l) => JSON.parse(l)).filter((o) => o.type === 'result');

const run = (args, opts = {}) =>
  execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', ...opts });

test('--help says what it does and does not do', () => {
  const out = run(['--help']);
  assert.match(out, /justjpeg <files or folders>/);
  assert.match(out, /No camera RAW here/i);
});

test('a HEIC becomes an upright JPEG with its metadata', () => {
  const src = path.join(dir, 'a.heic');
  fs.copyFileSync(path.join(FIX, 'withexif.heic'), src);
  const before = fs.readFileSync(src);

  const r = results(run([src, '--json']))[0];
  assert.equal(r.ok, true);
  // The fixture is portrait via EXIF orientation: upright means taller than wide.
  assert.ok(r.height > r.width, `should be upright, got ${r.width}x${r.height}`);

  const out = fs.readFileSync(r.out);
  assert.equal(out[0], 0xff); assert.equal(out[1], 0xd8);
  assert.ok(out.includes(Buffer.from('Exif')), 'EXIF should survive');
  assert.ok(before.equals(fs.readFileSync(src)), 'original must be untouched');
});

test('--strip removes the metadata', () => {
  const src = path.join(dir, 'b.heic');
  fs.copyFileSync(path.join(FIX, 'withexif.heic'), src);
  const r = results(run([src, '--strip', '--json']))[0];
  assert.ok(!fs.readFileSync(r.out).includes(Buffer.from('Exif')));
});

test('--size shrinks the long edge and no further', () => {
  const src = path.join(dir, 'c.heic');
  fs.copyFileSync(path.join(FIX, 'sample.heic'), src);
  const r = results(run([src, '--size', '500', '--json']))[0];
  assert.equal(Math.max(r.width, r.height), 500);
});

test('a folder converts everything inside it', () => {
  const sub = path.join(dir, 'folder', 'nested');
  fs.mkdirSync(sub, { recursive: true });
  fs.copyFileSync(path.join(FIX, 'sample.heic'), path.join(dir, 'folder', 'one.heic'));
  fs.copyFileSync(path.join(FIX, 'sample.png'), path.join(sub, 'two.png'));
  const lines = results(run([path.join(dir, 'folder'), '--json']));
  assert.equal(lines.length, 2, 'both files, subfolder included');
  for (const l of lines) assert.equal(l.ok, true);
});

test('an existing output is renamed, never replaced', () => {
  const src = path.join(dir, 'd.heic');
  fs.copyFileSync(path.join(FIX, 'sample.heic'), src);
  run([src, '--quiet']);
  const first = fs.readFileSync(path.join(dir, 'd.jpg'));
  run([src, '--quiet']);
  assert.ok(fs.readFileSync(path.join(dir, 'd.jpg')).equals(first), 'first output untouched');
  assert.ok(fs.existsSync(path.join(dir, 'd 2.jpg')), 'second run wrote a new name');
});

test('RAW is refused with a pointer at the app, exit 0 when nothing failed', () => {
  const src = path.join(dir, 'e.dng');
  fs.copyFileSync(path.join(FIX, 'sample.dng'), src);
  let err = '';
  try { execFileSync(process.execPath, [CLI, src], { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] }); }
  catch (e) { throw new Error('should not be a failure exit: ' + e.status); }
  err = execFileSync(process.execPath, [CLI, src], { encoding: 'utf8', stdio: ['pipe','pipe','pipe'] });
  const stderr = execSync(`${JSON.stringify(process.execPath)} ${JSON.stringify(CLI)} ${JSON.stringify(src)} 2>&1 1>/dev/null`, { encoding: 'utf8' });
  assert.match(stderr, /RAW/i);
  assert.match(stderr, /ponderdev\.com\/justjpeg/);
  assert.ok(!fs.existsSync(path.join(dir, 'e.jpg')), 'nothing written for RAW');
});

test('stdin to stdout pipes one image', () => {
  const out = path.join(dir, 'piped.jpg');
  execSync(
    `cat ${JSON.stringify(path.join(FIX, 'sample.heic'))} | ` +
    `${JSON.stringify(process.execPath)} ${JSON.stringify(CLI)} > ${JSON.stringify(out)} 2>/dev/null`,
  );
  const b = fs.readFileSync(out);
  assert.equal(b[0], 0xff); assert.equal(b[1], 0xd8);
  assert.ok(b.length > 1000, 'a real image, not a fragment');
});

test('stdin into a pipe arrives whole, not cut off at 64KB', () => {
  // Through `cat`, so stdout is a pipe: exiting early used to truncate it on macOS.
  const b = execSync(
    `cat ${JSON.stringify(path.join(FIX, 'sample.heic'))} | ` +
    `${JSON.stringify(process.execPath)} ${JSON.stringify(CLI)} 2>/dev/null | cat`,
    { maxBuffer: 64 * 1024 * 1024 },
  );
  assert.ok(b.length > 65536, `got ${b.length} bytes`);
  assert.equal(b[b.length - 2], 0xff); assert.equal(b[b.length - 1], 0xd9);
});

test('--overwrite never replaces another original in the batch', () => {
  const pair = path.join(dir, 'pair');
  fs.mkdirSync(pair);
  fs.copyFileSync(path.join(FIX, 'withexif.heic'), path.join(pair, 'IMG_0001.HEIC'));
  fs.copyFileSync(path.join(FIX, 'withexif.jpg'), path.join(pair, 'IMG_0001.jpg'));
  const before = fs.readFileSync(path.join(pair, 'IMG_0001.jpg'));
  run([pair, '--overwrite', '--quiet']);
  assert.deepEqual(fs.readFileSync(path.join(pair, 'IMG_0001.jpg')), before);
  assert.ok(fs.existsSync(path.join(pair, 'IMG_0001 2.jpg')));
});

test('an option missing its value, or a negative size, is refused', () => {
  const src = path.join(FIX, 'sample.png');
  for (const args of [[src, '-o'], [src, '--size', '-1'], [src, '-o', '--json']]) {
    assert.throws(() => run(args, { stdio: 'pipe' }), (e) => e.status === 2, args.join(' '));
  }
});

test('png output writes a png', () => {
  const src = path.join(dir, 'f.heic');
  fs.copyFileSync(path.join(FIX, 'sample.heic'), src);
  const r = results(run([src, '-f', 'png', '--json']))[0];
  const b = fs.readFileSync(r.out);
  assert.equal(b[1], 0x50, 'PNG magic');
});
