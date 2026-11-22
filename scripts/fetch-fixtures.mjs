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
// Locally the self-test leaves out a case whose fixture is missing, and says
// so. In CI (CI is set) a missing fixture fails the run: it never passes by
// skipping. A download that fails here exits 1 in CI for the same reason.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { RAW_FIXTURES } from '../test/raw-fixtures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'test/fixtures');

const FIXTURES = [
  {
    // An iPhone 13 Pro photo from pillow_heif's tests (BSD-3-Clause), pinned
    // to one commit. The sample site this came from before refuses CI runners.
    file: 's1.heic',
    url: 'https://raw.githubusercontent.com/bigcat88/pillow_heif/fbba42106392ff4c7aeda9cb577b55debc939eab/tests/images/heif_other/pug.heic',
    sha256: '1ddce96766efbfa0f6bdf634bdab26bdeff831393df8d67f4cdc7b7a7afebc67',
    why: 'a real photograph in HEIC, for the ordinary iPhone path',
  },
  {
    file: 's2.heic',
    url: 'https://raw.githubusercontent.com/strukturag/libheif/master/examples/example.heic',
    why: "libheif's own example file",
  },
  {
    // A Canon 5D Mark III raw, converted to DNG by Adobe's converter, from
    // raw.pixls.us (CC0). The same file as raw/adobe-dng-converter-canon5dm3.dng,
    // kept under this name for the tests that read it as the DNG case.
    file: 'sample.dng',
    url: 'https://raw.pixls.us/getfile.php/1033/nice/',
    sha256: 'b22f1e36331f679abb8b13e433b9bbde3988723adf10fee7aa0dda6381016a98',
    why: 'a genuine Canon raw file, for the LibRaw path',
  },
  // One real file per camera RAW format the README lists, from raw.pixls.us,
  // whose samples are public domain (CC0). CR3 has no sample there, so no CR3
  // case exists; the others each run through the app's LibRaw.
  { file: 'sample.cr2', url: 'https://raw.pixls.us/data-unique/Canon/EOS%2040D/_MG_0154.CR2', why: 'Canon CR2' },
  { file: 'sample.nef', url: 'https://raw.pixls.us/data-unique/Nikon/D7200/DSC_0979.NEF', why: 'Nikon NEF' },
  { file: 'sample.arw', url: 'https://raw.pixls.us/data-unique/Sony/ILCE-7S/DSC04126.ARW', why: 'Sony ARW' },
  { file: 'sample.raf', url: 'https://raw.pixls.us/data-unique/Fujifilm/X-Pro2/_DSF3051.RAF', why: 'Fujifilm RAF' },
  { file: 'sample.orf', url: 'https://raw.pixls.us/data-unique/Olympus/XZ-1/p1319978.orf', why: 'Olympus ORF' },
  { file: 'sample.rw2', url: 'https://raw.pixls.us/data-unique/Panasonic/DC-GH5S/P1022085.RW2', why: 'Panasonic RW2' },
  {
    file: 'sample.tiff',
    url: 'https://filesamples.com/samples/image/tiff/sample_640%C3%97426.tiff',
    why: 'a plain TIFF, which LibRaw refuses and UTIF has to pick up',
  },
];

// The command line's camera RAW set, one file per maker (CC0, raw.pixls.us),
// in test/fixtures/raw/. Each is checked against its sha256 when it arrives.
for (const f of RAW_FIXTURES) {
  FIXTURES.push({ file: `raw/${f.file}`, url: f.url, sha256: f.sha256, why: f.why });
}

await fs.mkdir(path.join(dir, 'raw'), { recursive: true });

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
    if (fixture.sha256 && crypto.createHash('sha256').update(bytes).digest('hex') !== fixture.sha256) {
      throw new Error('the download does not match its sha256, so it was not kept');
    }
    await fs.writeFile(target, bytes);
    fetched++;
    console.log(`  got     ${fixture.file}  ${(bytes.length / 1024).toFixed(0)}KB  (${fixture.why})`);
  } catch (err) {
    failed++;
    console.log(`  missed  ${fixture.file}  ${err.message}. Tests needing it will not run.`);
  }
}

console.log(`\n${fetched} fetched, ${failed} unavailable`);
if (failed && process.env.CI) process.exit(1);
