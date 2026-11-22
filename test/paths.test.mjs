// Safety rules for where converted files land.
//
//   node test/paths.test.mjs
//
// The rule that matters most: a conversion must never write over the file it
// is reading from. Everything else is recoverable; an overwritten original is
// not.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planOutput, outputPathFor, isSameFile, uniquePath, pathKey, isInOutputFormat, isOurs } from '../src/paths.js';
import { markJpeg, markPng } from '../src/mark.js';

// Build every path through path.join so the expectations hold on Windows too,
// where separators are backslashes.
const P = (...parts) => path.join(...parts);

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  pass  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}\n          ${err.message}`);
  }
}

// A pretend filesystem: any path listed here already exists. Compared after
// normalizing, so it behaves the same whichever separator the host uses.
const fsWith = (...taken) => {
  const set = new Set(taken.map((t) => path.resolve(t)));
  return (candidate) => set.has(path.resolve(candidate));
};
const none = () => false;

console.log('\nOutput paths\n');

check('HEIC beside the original becomes a .jpg', () => {
  assert.equal(outputPathFor('/photos/IMG_1.heic', null, 'jpeg'), P('/photos', 'IMG_1.jpg'));
});

check('a photo already in the output format is the one a results folder copies', () => {
  assert.ok(isInOutputFormat('/p/a.JPG', 'jpeg') && isInOutputFormat('/p/a.jpeg', 'jpeg'));
  assert.ok(!isInOutputFormat('/p/a.png', 'jpeg') && !isInOutputFormat('/p/a.heic', 'jpeg'));
  assert.ok(isInOutputFormat('/p/a.png', 'png') && !isInOutputFormat('/p/a.jpg', 'png'));
  assert.ok(isInOutputFormat('/p/a.jpg', 'jpeg', Buffer.from([0xff, 0xd8, 0xff])));
  assert.ok(!isInOutputFormat('/p/a.jpg', 'jpeg', Buffer.from('not a picture')), 'named .jpg but no JPEG inside: not copied');
});

check('an output folder keeps the file name', () => {
  assert.equal(outputPathFor('/photos/IMG_1.heic', '/out', 'jpeg'), P('/out', 'IMG_1.jpg'));
});

check('PNG output gets a .png extension', () => {
  assert.equal(outputPathFor('/photos/IMG_1.heic', null, 'png'), P('/photos', 'IMG_1.png'));
});

check('names containing dots keep everything but the extension', () => {
  assert.equal(outputPathFor('/photos/beach.day.2.heic', null, 'jpeg'), P('/photos', 'beach.day.2.jpg'));
});

console.log('\nNever overwrite the original\n');

check('JPEG to JPEG in place is skipped, not overwritten', () => {
  const plan = planOutput(
    { sourcePath: '/photos/a.jpg', outDir: null, format: 'jpeg', onExisting: 'overwrite' },
    fsWith('/photos/a.jpg'), 'darwin',
  );
  assert.equal(plan.action, 'skip', 'must refuse to write over the source');
  assert.equal(plan.reason, 'original', 'the skip must say why');
});

check('the same refusal holds when the case differs', () => {
  const plan = planOutput(
    { sourcePath: '/photos/A.JPG', outDir: null, format: 'jpeg', onExisting: 'overwrite' },
    fsWith('/photos/A.JPG'), 'darwin',
  );
  assert.equal(plan.action, 'skip');
});

check('on Linux, differing case really is a different file', () => {
  const plan = planOutput(
    { sourcePath: '/photos/A.JPG', outDir: null, format: 'jpeg', onExisting: 'overwrite' },
    none, 'linux',
  );
  assert.equal(plan.action, 'write');
  assert.equal(plan.path, P('/photos', 'A.jpg'));
});

check('"keep both" writes a new name rather than skipping', () => {
  const plan = planOutput(
    { sourcePath: '/photos/a.jpg', outDir: null, format: 'jpeg', onExisting: 'rename' },
    fsWith('/photos/a.jpg'), 'darwin',
  );
  assert.equal(plan.action, 'write');
  assert.equal(plan.path, P('/photos', 'a 2.jpg'));
});

check('an output folder makes JPEG to JPEG safe again', () => {
  const plan = planOutput(
    { sourcePath: '/photos/a.jpg', outDir: '/out', format: 'jpeg', onExisting: 'overwrite' },
    none, 'darwin',
  );
  assert.equal(plan.action, 'write');
  assert.equal(plan.path, P('/out', 'a.jpg'));
});

console.log('\nExisting files\n');

check('a free name is simply written', () => {
  const plan = planOutput(
    { sourcePath: '/photos/a.heic', outDir: null, format: 'jpeg', onExisting: 'skip' },
    none, 'darwin',
  );
  assert.deepEqual(plan, { path: P('/photos', 'a.jpg'), action: 'write' });
});

check('skip leaves an existing file alone', () => {
  const plan = planOutput(
    { sourcePath: '/photos/a.heic', outDir: null, format: 'jpeg', onExisting: 'skip' },
    fsWith('/photos/a.jpg'), 'darwin',
  );
  assert.equal(plan.action, 'skip');
  assert.equal(plan.reason, 'exists', 'the skip must say why');
});

check('replace overwrites a file Just JPEG made when asked', () => {
  const plan = planOutput(
    { sourcePath: '/photos/a.heic', outDir: null, format: 'jpeg', onExisting: 'overwrite' },
    fsWith('/photos/a.jpg'), 'darwin', () => false, () => true,
  );
  assert.deepEqual(plan, { path: P('/photos', 'a.jpg'), action: 'write' });
});

check('replace never replaces a real photo (no mark): it gets " 2"', () => {
  const plan = planOutput(
    { sourcePath: '/photos/a.heic', outDir: null, format: 'jpeg', onExisting: 'overwrite' },
    fsWith('/photos/a.jpg'), 'darwin', () => false, () => false,
  );
  assert.deepEqual(plan, { path: P('/photos', 'a 2.jpg'), action: 'write' });
  const bare = planOutput(
    { sourcePath: '/photos/a.heic', outDir: null, format: 'jpeg', onExisting: 'overwrite' },
    fsWith('/photos/a.jpg'), 'darwin',
  );
  assert.equal(bare.path, P('/photos', 'a 2.jpg'), 'with no reader given, nothing is replaced');
});

check('replace never replaces another original in the same run', () => {
  // IMG_0001.HEIC beside IMG_0001.JPG: the JPG is an original, not old output.
  const taken = new Set([pathKey('/photos/IMG_0001.HEIC', 'darwin'), pathKey('/photos/IMG_0001.JPG', 'darwin')]);
  const plan = planOutput(
    { sourcePath: '/photos/IMG_0001.HEIC', outDir: null, format: 'jpeg', onExisting: 'overwrite' },
    fsWith('/photos/IMG_0001.JPG'), 'darwin', (p) => taken.has(pathKey(p, 'darwin')),
  );
  assert.deepEqual(plan, { path: P('/photos', 'IMG_0001 2.jpg'), action: 'write' });
});

check('siblings with one stem never share an output, even before it is written', () => {
  const taken = new Set([pathKey('/photos/photo.jpg', 'linux')]);
  for (const onExisting of ['rename', 'overwrite']) {
    const plan = planOutput(
      { sourcePath: '/photos/photo.tiff', outDir: null, format: 'jpeg', onExisting },
      fsWith(), 'linux', (p) => taken.has(pathKey(p, 'linux')),
    );
    assert.deepEqual(plan, { path: P('/photos', 'photo 2.jpg'), action: 'write' }, onExisting);
  }
});

check('keep both counts past the names already taken', () => {
  const plan = planOutput(
    { sourcePath: '/photos/a.heic', outDir: null, format: 'jpeg', onExisting: 'rename' },
    fsWith('/photos/a.jpg', '/photos/a 2.jpg', '/photos/a 3.jpg'), 'darwin',
  );
  assert.equal(plan.path, P('/photos', 'a 4.jpg'));
});

check('running out of names refuses rather than clobbering', () => {
  assert.throws(() => uniquePath('/photos/a.jpg', () => true), /Too many files/);
});

check('isSameFile ignores case only where the platform does', () => {
  assert.equal(isSameFile('/a/B.jpg', '/a/b.jpg', 'darwin'), true);
  assert.equal(isSameFile('/a/B.jpg', '/a/b.jpg', 'win32'), true);
  assert.equal(isSameFile('/a/B.jpg', '/a/b.jpg', 'linux'), false);
});

console.log('\nThe mark\n');

check('isOurs reads the mark off disk: marked JPEG and PNG yes, plain ones no', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'justjpeg-mark-'));
  try {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0, 4, 1, 2, 0xff, 0xda, 0, 2]);
    const png = new Uint8Array(8 + 25 + 12);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); png[11] = 13; png.set([0x49, 0x48, 0x44, 0x52], 12);
    png.set([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44], 8 + 25);
    const put = (name, bytes) => { const f = path.join(d, name); fs.writeFileSync(f, bytes); return f; };
    assert.equal(isOurs(put('plain.jpg', jpg)), false);
    assert.equal(isOurs(put('ours.jpg', markJpeg(jpg))), true);
    assert.equal(isOurs(put('plain.png', png)), false);
    assert.equal(isOurs(put('ours.png', markPng(png))), true);
    assert.equal(isOurs(put('other.jpg', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xfe, 0, 11]), Buffer.from('Not ours!!'), Buffer.from([0xff, 0xda])]))), false);
    assert.equal(isOurs(path.join(d, 'missing.jpg')), false);
    assert.equal(isOurs(put('empty.jpg', '')), false);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
