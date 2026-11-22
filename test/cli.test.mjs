// The command line, end to end, as a subprocess.
//
//   node test/cli.test.mjs
//
// Real fixtures, the real binary, the way a terminal would run it.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { hasMarkInBytes } from '../src/mark.js';

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
  assert.match(out, /camera RAW/i);
  assert.doesNotMatch(out, /No camera RAW here/i);
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
  const lines = results(run([path.join(dir, 'folder'), '--beside', '--json']));
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

test('stdin to stdout pipes one image', () => {
  const r = spawnSync(process.execPath, [CLI], {
    input: fs.readFileSync(path.join(FIX, 'sample.heic')),
    stdio: ['pipe', 'pipe', 'ignore'],
    maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(r.status, 0);
  const b = r.stdout;
  assert.equal(b[0], 0xff); assert.equal(b[1], 0xd8);
  assert.ok(b.length > 1000, 'a real image, not a fragment');
});

test('stdin into a pipe arrives whole, not cut off at 64KB', () => {
  // Node reads the child's stdout through a pipe, as `| cat` did: exiting early used to truncate it on macOS.
  const r = spawnSync(process.execPath, [CLI], {
    input: fs.readFileSync(path.join(FIX, 'sample.heic')),
    stdio: ['pipe', 'pipe', 'ignore'],
    maxBuffer: 64 * 1024 * 1024,
  });
  const b = r.stdout;
  assert.ok(b.length > 65536, `got ${b.length} bytes`);
  assert.equal(b[b.length - 2], 0xff); assert.equal(b[b.length - 1], 0xd9);
});

test('--overwrite never replaces another original in the batch', () => {
  const pair = path.join(dir, 'pair');
  fs.mkdirSync(pair);
  fs.copyFileSync(path.join(FIX, 'withexif.heic'), path.join(pair, 'IMG_0001.HEIC'));
  fs.copyFileSync(path.join(FIX, 'withexif.jpg'), path.join(pair, 'IMG_0001.jpg'));
  const before = fs.readFileSync(path.join(pair, 'IMG_0001.jpg'));
  run([pair, '--beside', '--overwrite', '--quiet']);
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

test('run again on a folder, its own results are left alone', () => {
  const again = path.join(dir, 'again');
  fs.mkdirSync(again);
  fs.copyFileSync(path.join(FIX, 'sample.heic'), path.join(again, 'shot.heic'));
  run([again, '--beside', '--quiet']);
  const made = fs.readFileSync(path.join(again, 'shot.jpg'));
  const lines = run([again, '--beside', '--json']).trim().split('\n').map((l) => JSON.parse(l));
  const skip = lines.find((l) => l.type === 'skip');
  assert.equal(skip.reason, 'earlier-output');
  assert.equal(path.basename(skip.input), 'shot.jpg');
  assert.equal(path.basename(skip.from), 'shot.heic');
  assert.ok(!results(lines.map((l) => JSON.stringify(l)).join('\n')).some((r) => path.basename(r.input) === 'shot.jpg'));
  assert.deepEqual(fs.readFileSync(path.join(again, 'shot.jpg')), made);
  assert.ok(!fs.readdirSync(again).some((f) => f.startsWith('shot 2 ')), 'no result made from a result');
  // Into another folder nothing is skipped: shot.heic, shot.jpg and the
  // second run's shot 2.jpg all convert.
  const out = path.join(dir, 'again-out');
  assert.equal(results(run([again, '-o', out, '--json'])).length, 3);
});

test('a skip that would replace the original says so, not "output exists"', () => {
  const src = path.join(dir, 'self.jpg');
  fs.copyFileSync(path.join(FIX, 'plain.jpg'), src);
  const r = execFileSync(process.execPath, [CLI, src, '--overwrite'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const json = run([src, '--overwrite', '--json']).trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(json[0].type, 'skip');
  assert.equal(json[0].reason, 'original');
  assert.equal(json[0].message, 'it would replace the original');
  assert.equal(r, '');
});

test('a folder\'s results go into a new "folder (JPEG)" beside it, subfolders mirrored, the folder untouched', () => {
  const holiday = path.join(dir, 'Holiday');
  fs.mkdirSync(path.join(holiday, 'beach'), { recursive: true });
  fs.copyFileSync(path.join(FIX, 'sample.png'), path.join(holiday, 'one.png'));
  fs.copyFileSync(path.join(FIX, 'sample.png'), path.join(holiday, 'beach', 'two.png'));
  fs.writeFileSync(path.join(holiday, 'notes.txt'), 'not a photo');
  fs.copyFileSync(path.join(FIX, 'plain.jpg'), path.join(holiday, 'beach', 'already.jpg'));
  const before = fs.readdirSync(holiday).sort();
  const lines = results(run([holiday, '--json']));
  assert.equal(lines.length, 3);
  const into = path.join(dir, 'Holiday (JPEG)');
  assert.deepEqual(lines.map((l) => l.out).sort(), [path.join(into, 'beach', 'already.jpg'), path.join(into, 'beach', 'two.jpg'), path.join(into, 'one.jpg')]);
  // The results folder is complete: a JPEG is copied in as it is, and says so.
  const copied = lines.filter((l) => l.copied);
  assert.equal(copied.length, 1);
  assert.equal(path.basename(copied[0].out), 'already.jpg');
  assert.ok(fs.readFileSync(path.join(into, 'beach', 'already.jpg')).equals(fs.readFileSync(path.join(FIX, 'plain.jpg'))), 'copied byte for byte');
  assert.deepEqual(fs.readdirSync(holiday).sort(), before, 'the folder itself is untouched');

  // Again: a new "Holiday (JPEG) 2", and the first results folder is not taken in.
  const second = results(run([holiday, '--json']));
  assert.equal(second.length, 3);
  assert.ok(second.every((l) => l.out.startsWith(path.join(dir, 'Holiday (JPEG) 2'))));
  // Handed the parent folder, a results folder is passed over.
  const parent = path.join(dir, 'parent');
  fs.mkdirSync(path.join(parent, 'Trip'), { recursive: true });
  fs.mkdirSync(path.join(parent, 'Trip (JPEG)'));
  fs.copyFileSync(path.join(FIX, 'sample.png'), path.join(parent, 'Trip', 'x.png'));
  fs.copyFileSync(path.join(FIX, 'sample.png'), path.join(parent, 'Trip (JPEG)', 'x.jpg'));
  const viaParent = results(run([parent, '--dry-run', '--json']));
  assert.deepEqual(viaParent.map((l) => path.basename(l.input)), ['x.png']);
});

test('--beside saves each result beside its original, copying nothing; a file named on its own always does', () => {
  const f = path.join(dir, 'Beside');
  fs.mkdirSync(f);
  fs.copyFileSync(path.join(FIX, 'sample.png'), path.join(f, 'p.png'));
  fs.copyFileSync(path.join(FIX, 'plain.jpg'), path.join(f, 'q.jpg'));
  const beside = run([f, '--beside', '--json']).trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(beside.find((l) => l.type === 'result').out, path.join(f, 'p.jpg'));
  assert.ok(!beside.some((l) => l.copied), 'nothing is copied beside the originals');
  assert.ok(!fs.existsSync(path.join(dir, 'Beside (JPEG)')), 'and no results folder');
  assert.ok(!fs.existsSync(path.join(dir, 'Beside (JPEG)')), 'no results folder with --beside');
  const own = results(run([path.join(f, 'p.png'), '--json']))[0];
  assert.equal(path.dirname(own.out), f, 'a file named on its own goes beside it');
  assert.ok(!fs.existsSync(path.join(dir, 'Beside (JPEG)')));
});

test('-o still wins for a folder, with its subfolders mirrored inside', () => {
  const f = path.join(dir, 'ToOut');
  fs.mkdirSync(path.join(f, 'deep'), { recursive: true });
  fs.copyFileSync(path.join(FIX, 'sample.png'), path.join(f, 'top.png'));
  fs.copyFileSync(path.join(FIX, 'sample.png'), path.join(f, 'deep', 'low.png'));
  const out = path.join(dir, 'chosen');
  run([f, '-o', out, '--quiet']);
  assert.ok(fs.existsSync(path.join(out, 'top.jpg')));
  assert.ok(fs.existsSync(path.join(out, 'deep', 'low.jpg')));
  assert.ok(!fs.existsSync(path.join(dir, 'ToOut (JPEG)')), 'no results folder when -o is given');
});

test('a file named on its own that is not a kind it takes is not converted', () => {
  const txt = path.join(dir, 'notes.txt');
  fs.writeFileSync(txt, 'hello');
  assert.throws(() => run([txt], { stdio: 'pipe' }), (e) => e.status === 2);
});

test('nothing is left behind when a folder run finds nothing to write', () => {
  const f = path.join(dir, 'Empty');
  fs.mkdirSync(f);
  fs.writeFileSync(path.join(f, 'bad.jpg'), 'not a picture');
  assert.throws(() => run([f, '--quiet'], { stdio: 'pipe' }), (e) => e.status === 1);
  assert.ok(!fs.existsSync(path.join(dir, 'Empty (JPEG)')), 'no empty results folder');
});

test('a results folder is complete in PNG too: a PNG is copied in, a JPEG is converted', () => {
  const f = path.join(dir, 'Mixed');
  fs.mkdirSync(f);
  fs.copyFileSync(path.join(FIX, 'sample.png'), path.join(f, 'a.png'));
  fs.copyFileSync(path.join(FIX, 'plain.jpg'), path.join(f, 'b.jpg'));
  const lines = results(run([f, '-f', 'png', '--json']));
  assert.equal(lines.length, 2);
  assert.equal(lines.find((l) => path.basename(l.input) === 'a.png').copied, true);
  assert.equal(lines.find((l) => path.basename(l.input) === 'b.jpg').copied, undefined);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'Mixed (JPEG)')).sort(), ['a.png', 'b.png']);
});

test('run again after a run again: numbered results (photo 2.jpg, photo 2 2.jpg) are left alone too', () => {
  const f = path.join(dir, 'Numbered');
  fs.mkdirSync(f);
  fs.copyFileSync(path.join(FIX, 'sample.heic'), path.join(f, 'photo.heic'));
  fs.copyFileSync(path.join(FIX, 'sample.png'), path.join(f, 'photo.png'));
  // What two earlier runs left: photo.jpg, then the kept-both photo 2.jpg and photo 2 2.jpg.
  for (const n of ['photo.jpg', 'photo 2.jpg', 'photo 2 2.jpg']) fs.copyFileSync(path.join(FIX, 'plain.jpg'), path.join(f, n));
  const lines = run([f, '--beside', '--dry-run', '--json']).trim().split('\n').map((l) => JSON.parse(l));
  const skips = lines.filter((l) => l.type === 'skip').map((l) => path.basename(l.input)).sort();
  assert.deepEqual(skips, ['photo 2 2.jpg', 'photo 2.jpg', 'photo.jpg']);
  assert.ok(lines.filter((l) => l.type === 'skip').every((l) => l.reason === 'earlier-output'));
  // A numbered JPEG with no other-format photo of that name is just a photo.
  fs.copyFileSync(path.join(FIX, 'plain.jpg'), path.join(f, 'holiday 2.jpg'));
  const again = run([f, '--beside', '--dry-run', '--json']).trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(again.some((l) => l.type === 'result' && path.basename(l.input) === 'holiday 2.jpg'));
});

test('--overwrite with photos that share a name: each keeps its own result, none replaces another', () => {
  const f = path.join(dir, 'SameStem');
  fs.mkdirSync(f);
  fs.copyFileSync(path.join(FIX, 'sample.heic'), path.join(f, 'photo.heic'));
  fs.copyFileSync(path.join(FIX, 'sample.png'), path.join(f, 'photo.png'));
  const outs = results(run([f, '--beside', '--overwrite', '--json'])).map((l) => path.basename(l.out)).sort();
  assert.deepEqual(outs, ['photo 2.jpg', 'photo.jpg']);
  assert.ok(fs.existsSync(path.join(f, 'photo.png')), 'the other original is untouched');
});

test('--overwrite replaces the picture a first run made, but never a real photo with the same name', () => {
  const f = path.join(dir, 'Mark');
  fs.mkdirSync(f);
  fs.copyFileSync(path.join(FIX, 'sample.heic'), path.join(f, 'ours.heic'));
  fs.copyFileSync(path.join(FIX, 'sample.heic'), path.join(f, 'real.heic'));
  const first = path.join(f, 'ours.jpg');
  run([path.join(f, 'ours.heic'), '--quiet']);
  const made = fs.readFileSync(first);
  // Different settings, so a replacement has different bytes.
  const r = results(run([path.join(f, 'ours.heic'), '-q', '50', '--overwrite', '--json']))[0];
  assert.equal(r.out, first, 'same path');
  assert.ok(!made.equals(fs.readFileSync(first)), 'new bytes');
  assert.ok(!fs.existsSync(path.join(f, 'ours 2.jpg')));
  // A real photo already called real.jpg.
  const real = path.join(f, 'real.jpg');
  fs.copyFileSync(path.join(FIX, 'plain.jpg'), real);
  const rr = results(run([path.join(f, 'real.heic'), '--overwrite', '--json']))[0];
  assert.equal(rr.out, path.join(f, 'real 2.jpg'));
  assert.ok(fs.readFileSync(real).equals(fs.readFileSync(path.join(FIX, 'plain.jpg'))), 'the real photo is untouched');
});

test('JPEG and PNG output carry the mark; a photo copied in does not; the file still opens', () => {
  const f = path.join(dir, 'MarkFormats');
  fs.mkdirSync(f);
  fs.copyFileSync(path.join(FIX, 'withexif.heic'), path.join(f, 'a.heic'));
  fs.copyFileSync(path.join(FIX, 'plain.jpg'), path.join(f, 'b.jpg'));
  run([f, '--quiet']);
  const into = path.join(dir, 'MarkFormats (JPEG)');
  const jpg = fs.readFileSync(path.join(into, 'a.jpg'));
  assert.ok(hasMarkInBytes(jpg), 'converted JPEG is marked');
  assert.ok(jpg.includes(Buffer.from('Exif')), 'EXIF still carried');
  assert.ok(jpg.includes(Buffer.from([0xff, 0xfe, 0, 11, ...Buffer.from('Just JPEG')])), 'the exact COM segment');
  assert.ok(!hasMarkInBytes(fs.readFileSync(path.join(into, 'b.jpg'))), 'copied-in photo is not marked');
  assert.ok(fs.readFileSync(path.join(into, 'b.jpg')).equals(fs.readFileSync(path.join(FIX, 'plain.jpg'))));
  const png = results(run([path.join(FIX, 'sample.heic'), '-f', 'png', '-o', path.join(dir, 'MarkPng'), '--json']))[0];
  const pngBytes = fs.readFileSync(png.out);
  assert.ok(hasMarkInBytes(pngBytes), 'converted PNG is marked');
  assert.ok(pngBytes.includes(Buffer.from('Software\0Just JPEG')));
  if (process.platform === 'darwin') {
    for (const file of [path.join(into, 'a.jpg'), png.out]) {
      const s = spawnSync('sips', ['-g', 'pixelWidth', file], { encoding: 'utf8' });
      assert.equal(s.status, 0, `sips opens ${file}`);
    }
  }
});

// --- the phone folder, and the formats the command line leaves to the app (tools-78) ---

test('a phone folder: Live Photo .MOV and .AAE sidecars beside the HEICs are not pictures, so none is a failure or "could not be read"', () => {
  const phone = path.join(dir, 'phone', 'DCIM', '100APPLE');
  fs.mkdirSync(phone, { recursive: true });
  for (const n of ['IMG_0001', 'IMG_0002']) {
    fs.copyFileSync(path.join(FIX, 'withexif.heic'), path.join(phone, `${n}.HEIC`));
    fs.writeFileSync(path.join(phone, `${n}.MOV`), Buffer.alloc(4096, 7));
    fs.writeFileSync(path.join(phone, `${n}.AAE`), '<?xml version="1.0"?><plist version="1.0"><dict/></plist>');
  }
  fs.writeFileSync(path.join(phone, '.DS_Store'), 'x');
  const out = run([path.join(dir, 'phone'), '--json']);
  const lines = out.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.filter((o) => o.type === 'result' && o.ok).length, 2, 'the two HEICs');
  const done = lines.find((o) => o.type === 'done');
  assert.deepEqual([done.results, done.skipped, done.failed, done.exit], [2, 0, 0, 0]);
  assert.ok(!out.includes('.MOV') && !out.includes('.AAE'), 'the sidecars are not even mentioned');
  const made = fs.readdirSync(path.join(dir, 'phone (JPEG)', 'DCIM', '100APPLE')).sort();
  assert.deepEqual(made, ['IMG_0001.jpg', 'IMG_0002.jpg']);
});

test('AVIF: the command line says it is the app\'s, by name, and writes nothing', () => {
  const src = path.join(dir, 'pic.avif');
  fs.copyFileSync(path.join(FIX, 'pattern.avif'), src);
  const r = spawnSync(process.execPath, [CLI, src, '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /looks like AVIF, which the command line does not convert/);
  assert.ok(!fs.existsSync(path.join(dir, 'pic.jpg')));
});

test('GIF and BMP: the command line does not pick them up (the app does)', () => {
  for (const name of ['pattern.gif', 'pattern.bmp']) {
    const src = path.join(dir, name);
    fs.copyFileSync(path.join(FIX, name), src);
    const r = spawnSync(process.execPath, [CLI, src, '--json'], { encoding: 'utf8' });
    assert.equal(r.status, 2, name);
    assert.match(r.stdout + r.stderr, /Nothing here that looks like an image/);
  }
});
