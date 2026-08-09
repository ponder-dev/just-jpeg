// Safety rules for where converted files land.
//
//   node test/paths.test.mjs
//
// The rule that matters most: a conversion must never write over the file it
// is reading from. Everything else is recoverable; an overwritten original is
// not.

import assert from 'node:assert/strict';
import path from 'node:path';
import { planOutput, outputPathFor, isSameFile, uniquePath } from '../src/paths.js';

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
// normalising, so it behaves the same whichever separator the host uses.
const fsWith = (...taken) => {
  const set = new Set(taken.map((t) => path.resolve(t)));
  return (candidate) => set.has(path.resolve(candidate));
};
const none = () => false;

console.log('\nOutput paths\n');

check('HEIC beside the original becomes a .jpg', () => {
  assert.equal(outputPathFor('/photos/IMG_1.heic', null, 'jpeg'), P('/photos', 'IMG_1.jpg'));
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
});

check('replace overwrites a different file when asked', () => {
  const plan = planOutput(
    { sourcePath: '/photos/a.heic', outDir: null, format: 'jpeg', onExisting: 'overwrite' },
    fsWith('/photos/a.jpg'), 'darwin',
  );
  assert.deepEqual(plan, { path: P('/photos', 'a.jpg'), action: 'write' });
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

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
