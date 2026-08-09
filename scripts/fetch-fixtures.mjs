// Downloads the test images that are not ours to redistribute.
//
//   node scripts/fetch-fixtures.mjs
//
// The fixtures in test/fixtures that ship with this repo are generated ones:
// plasma and gradient patterns with no third-party content in them. The files
// below are real photographs and camera RAW files from public sample sets,
// which we use for testing but do not republish. They are fetched on demand
// and git-ignored.
//
// Tests skip any case whose fixture is missing, so this is optional locally.
// CI runs it so the RAW and real-photo paths stay covered.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'test/fixtures');

const FIXTURES = [
  {
    file: 's1.heic',
    url: 'https://filesamples.com/samples/image/heic/sample1.heic',
    why: 'a real photograph in HEIC, for the ordinary iPhone path',
  },
  {
    file: 's2.heic',
    url: 'https://raw.githubusercontent.com/strukturag/libheif/master/examples/example.heic',
    why: "libheif's own example file",
  },
  {
    file: 'sample.dng',
    url: 'https://filesamples.com/samples/image/dng/sample1.dng',
    why: 'a genuine Canon raw file, for the LibRaw path',
  },
  {
    file: 'sample.tiff',
    url: 'https://filesamples.com/samples/image/tiff/sample_640%C3%97426.tiff',
    why: 'a plain TIFF, which LibRaw refuses and UTIF has to pick up',
  },
];

await fs.mkdir(dir, { recursive: true });

let fetched = 0;
let failed = 0;

for (const fixture of FIXTURES) {
  const target = path.join(dir, fixture.file);
  try {
    await fs.access(target);
    console.log(`  have    ${fixture.file}`);
    continue;
  } catch { /* not there yet, go and get it */ }

  try {
    const response = await fetch(fixture.url, { redirect: 'follow' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 1024) throw new Error('suspiciously small');
    await fs.writeFile(target, bytes);
    fetched++;
    console.log(`  got     ${fixture.file}  ${(bytes.length / 1024).toFixed(0)}KB  (${fixture.why})`);
  } catch (err) {
    failed++;
    console.log(`  missed  ${fixture.file}  ${err.message}. Tests needing it will be skipped.`);
  }
}

console.log(`\n${fetched} fetched, ${failed} unavailable`);
