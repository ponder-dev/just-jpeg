// A plain TIFF's own turn and colour profile, and the size tags in carried-over
// EXIF. Built by hand, so no fixture file is needed.
//
//   node test/tiff.test.mjs

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setPixelSize, exifFromJpeg } from '../src/exif.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(root, 'src', 'cli.mjs');
const FIX = path.join(root, 'test', 'fixtures');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'justjpeg-tiff-'));
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));

// A little-endian, uncompressed RGB TIFF, `w` by `h`, with an Orientation tag
// and (when given) an ICC profile tag.
function makeTiff({ w, h, orientation, icc }) {
  const entries = [];
  const pixels = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) { pixels[i * 3] = (i * 40) & 255; pixels[i * 3 + 1] = 90; pixels[i * 3 + 2] = 200 - i * 10; }
  const n = 10 + (icc ? 1 : 0);
  const ifdSize = 2 + n * 12 + 4;
  const bitsAt = 8 + ifdSize;              // 3 SHORTs, 6 bytes
  const stripAt = bitsAt + 6;
  const iccAt = stripAt + pixels.length;
  const E = (tag, type, count, value) => entries.push({ tag, type, count, value });
  E(256, 3, 1, w); E(257, 3, 1, h); E(258, 3, 3, bitsAt); E(259, 3, 1, 1); E(262, 3, 1, 2);
  E(273, 4, 1, stripAt); E(274, 3, 1, orientation); E(277, 3, 1, 3); E(278, 3, 1, h); E(279, 4, 1, pixels.length);
  if (icc) E(34675, 7, icc.length, iccAt);
  entries.sort((a, b) => a.tag - b.tag);
  const out = Buffer.alloc(iccAt + (icc ? icc.length : 0));
  out.write('II', 0); out.writeUInt16LE(42, 2); out.writeUInt32LE(8, 4);
  out.writeUInt16LE(entries.length, 8);
  entries.forEach((e, i) => {
    const o = 10 + i * 12;
    out.writeUInt16LE(e.tag, o); out.writeUInt16LE(e.type, o + 2); out.writeUInt32LE(e.count, o + 4);
    if (e.type === 3 && e.count === 1) out.writeUInt16LE(e.value, o + 8); else out.writeUInt32LE(e.value, o + 8);
  });
  out.writeUInt16LE(8, bitsAt); out.writeUInt16LE(8, bitsAt + 2); out.writeUInt16LE(8, bitsAt + 4);
  pixels.copy(out, stripAt);
  if (icc) Buffer.from(icc).copy(out, iccAt);
  return out;
}

const profile = Buffer.alloc(300, 7);
profile.writeUInt32BE(300, 0);
profile.write('acsp', 36, 'latin1');

function convert(tiff, name, extra = []) {
  const src = path.join(dir, name);
  fs.writeFileSync(src, tiff);
  const r = spawnSync(process.execPath, [CLI, src, '--json', ...extra], { encoding: 'utf8' });
  const line = r.stdout.trim().split('\n').map((l) => JSON.parse(l)).find((l) => l.type === 'result');
  assert.ok(line, `no result: ${r.stderr}`);
  return { ...line, bytes: fs.readFileSync(line.out) };
}

test('a TIFF turned by its orientation tag comes out upright', () => {
  const upright = convert(makeTiff({ w: 4, h: 2, orientation: 1 }), 'flat.tif');
  assert.deepEqual([upright.width, upright.height], [4, 2]);
  const turned = convert(makeTiff({ w: 4, h: 2, orientation: 6 }), 'turned.tif');
  assert.deepEqual([turned.width, turned.height], [2, 4], 'a quarter turn swaps the sides');
});

test('a TIFF\'s colour profile goes into the JPEG', () => {
  const r = convert(makeTiff({ w: 4, h: 2, orientation: 1, icc: profile }), 'icc.tif');
  assert.ok(r.bytes.includes(Buffer.from('ICC_PROFILE')), 'profile carried');
  assert.ok(r.bytes.includes(Buffer.from('acsp')));
  const none = convert(makeTiff({ w: 4, h: 2, orientation: 1 }), 'noicc.tif');
  assert.ok(!none.bytes.includes(Buffer.from('ICC_PROFILE')));
});

// An EXIF block: IFD0 with Orientation and an Exif sub-IFD, which holds the
// size tags as a viewer reads them.
function exifBlock(w, h, type = 4) {
  const b = Buffer.alloc(8 + 2 + 2 * 12 + 4 + 2 + 2 * 12 + 4);
  b.write('II', 0); b.writeUInt16LE(42, 2); b.writeUInt32LE(8, 4);
  b.writeUInt16LE(2, 8);
  b.writeUInt16LE(0x0112, 10); b.writeUInt16LE(3, 12); b.writeUInt32LE(1, 14); b.writeUInt16LE(6, 18);
  b.writeUInt16LE(0x8769, 22); b.writeUInt16LE(4, 24); b.writeUInt32LE(1, 26); b.writeUInt32LE(8 + 2 + 24 + 4, 30);
  const sub = 8 + 2 + 24 + 4;
  b.writeUInt16LE(2, sub);
  for (const [i, [tag, v]] of [[0xa002, w], [0xa003, h]].entries()) {
    const o = sub + 2 + i * 12;
    b.writeUInt16LE(tag, o); b.writeUInt16LE(type, o + 2); b.writeUInt32LE(1, o + 4);
    if (type === 3) b.writeUInt16LE(v, o + 8); else b.writeUInt32LE(v, o + 8);
  }
  return new Uint8Array(b);
}
const sizeOf = (t) => {
  const b = Buffer.from(t);
  const sub = b.readUInt32LE(30);
  const at = (i) => (b.readUInt16LE(sub + 2 + i * 12 + 2) === 3 ? b.readUInt16LE(sub + 2 + i * 12 + 8) : b.readUInt32LE(sub + 2 + i * 12 + 8));
  return [at(0), at(1)];
};

test('setPixelSize rewrites the size tags, SHORT or LONG, and widens a SHORT that no longer fits', () => {
  assert.deepEqual(sizeOf(setPixelSize(exifBlock(4032, 3024), 500, 375)), [500, 375]);
  assert.deepEqual(sizeOf(setPixelSize(exifBlock(4032, 3024, 3), 500, 375)), [500, 375]);
  assert.deepEqual(sizeOf(setPixelSize(exifBlock(4032, 3024, 3), 70000, 3024)), [70000, 3024]);
  assert.doesNotThrow(() => setPixelSize(new Uint8Array(4), 1, 1));
});

test('a converted photo\'s EXIF names the size of the file it sits in', () => {
  // A JPEG whose EXIF still says 4032 x 3024, shrunk to a long edge of 100.
  const plain = fs.readFileSync(path.join(FIX, 'plain.jpg'));
  const tiffIn = Buffer.from(exifBlock(4032, 3024));
  const head = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiffIn]);
  const app1 = Buffer.alloc(4); app1[0] = 0xff; app1[1] = 0xe1; app1.writeUInt16BE(head.length + 2, 2);
  const src = path.join(dir, 'sized.jpg');
  fs.writeFileSync(src, Buffer.concat([plain.subarray(0, 2), app1, head, plain.subarray(2)]));
  const r = spawnSync(process.execPath, [CLI, src, '--size', '100', '--json'], { encoding: 'utf8' });
  const line = r.stdout.trim().split('\n').map((l) => JSON.parse(l)).find((l) => l.type === 'result');
  assert.ok(line, r.stderr);
  const tiff = exifFromJpeg(new Uint8Array(fs.readFileSync(line.out)));
  assert.ok(tiff, 'EXIF carried');
  assert.deepEqual(sizeOf(tiff), [line.width, line.height]);
  assert.equal(Math.max(line.width, line.height), 100);
});
