// Runs the real conversion worker inside real Electron against the fixtures,
// then prints a pass/fail table. This is the check that matters, because the
// worker depends on WASM and OffscreenCanvas, neither of which exist in plain
// Node.
//
//   npx electron test/selftest.cjs

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const FIXTURES = path.join(__dirname, 'fixtures');
const OUT = path.join(__dirname, 'output');

// name, format, expectations
const CASES = [
  { file: 'sample.heic', format: 'jpeg', quality: 85, expect: { w: 4032, h: 3024 } },
  { file: 'sample.heic', format: 'png', quality: 85, expect: { w: 4032, h: 3024 } },
  { file: 'sample.heic', format: 'jpeg', quality: 80, maxDim: 1200, expect: { w: 1200, h: 900 } },
  { file: 'withexif.heic', format: 'jpeg', quality: 90, expect: { exif: true, rotated: true } },
  { file: 's1.heic', format: 'jpeg', quality: 85, expect: {} },
  { file: 's2.heic', format: 'jpeg', quality: 85, expect: {} },
  { file: 'withexif.jpg', format: 'jpeg', quality: 85, expect: { exif: true } },
  { file: 'sample.png', format: 'jpeg', quality: 85, expect: { w: 800, h: 600 } },
  { file: 'sample.dng', format: 'jpeg', quality: 85, expect: { raw: true, exif: true } },
  { file: 'sample.tiff', format: 'jpeg', quality: 85, expect: { raw: true } },
  // One camera RAW per format the README lists (the command line runs every maker's file: test/raw.test.mjs).
  { file: 'sample.cr2', format: 'jpeg', quality: 85, expect: { raw: true } },
  { file: 'sample.nef', format: 'jpeg', quality: 85, expect: { raw: true } },
  { file: 'sample.arw', format: 'jpeg', quality: 85, expect: { raw: true } },
  { file: 'sample.raf', format: 'jpeg', quality: 85, expect: { raw: true } },
  { file: 'sample.orf', format: 'jpeg', quality: 85, expect: { raw: true } },
  { file: 'sample.rw2', format: 'jpeg', quality: 85, expect: { raw: true } },
  // CR3 has no sample.* of its own; the app takes it from the command line's fetched set, as it does an
  // upright iPhone ProRAW (LibRaw turns it upright already, so the window must not turn it again).
  { file: 'raw/canon-eos-r6.cr3', format: 'jpeg', quality: 85, expect: { raw: true, w: 3407, h: 2271 } },
  { file: 'raw/apple-iphone12pro-proraw-portrait.dng', format: 'jpeg', quality: 85, expect: { raw: true, w: 3024, h: 4032 } },
  // The browser's own decoder takes these three in the app (the command line has none of GIF and BMP).
  { file: 'pattern.gif', format: 'jpeg', quality: 85, expect: { w: 320, h: 240 } },
  { file: 'pattern.bmp', format: 'jpeg', quality: 85, expect: { w: 320, h: 240 } },
  { file: 'pattern.avif', format: 'jpeg', quality: 85, expect: { w: 320, h: 240 } },
  { file: 'p3.heic', format: 'jpeg', quality: 92, expect: { icc: true } },
  { file: 's1.heic', format: 'jpeg', quality: 92, maxQuality: true, expect: { fullChroma: true } },
  { file: 'sample.dng', format: 'jpeg', quality: 92, maxQuality: true, expect: { fullChroma: true, exif: true } },
  // Unticking "keep photo details" has to genuinely strip it, GPS included.
  { file: 'withexif.heic', format: 'jpeg', quality: 85, keepMetadata: false, expect: { noExif: true } },
  { file: 'withexif.jpg', format: 'jpeg', quality: 85, keepMetadata: false, expect: { noExif: true } },
];

ipcMain.handle('fixture', (_e, name) => {
  const buf = fs.readFileSync(path.join(FIXTURES, name));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});

// Some fixtures are fetched rather than committed, so they may not be here.
// Locally a missing one is left out and said so; in CI (CI is set) it fails
// the run, so a RAW format can never pass by not running.
const MISSING = [];
ipcMain.handle('cases', () => CASES.filter((c) => {
  const present = fs.existsSync(path.join(FIXTURES, c.file));
  if (!present) {
    console.log(`    ${process.env.CI ? 'MISSING' : 'skipping'} ${c.file}: not downloaded, run scripts/fetch-fixtures.mjs`);
    MISSING.push(c.file);
  }
  return present;
}));

// The same RAW file through the command line's side, under this app's own
// runtime run as plain node (ELECTRON_RUN_AS_NODE), which is how the packaged
// app runs its command line: the pixels the shared decoder returns there, and
// one whole conversion by src/cli.mjs. The window compares the pixels with its own.
ipcMain.handle('node-raw', (_e, name) => {
  const file = path.join(FIXTURES, name);
  if (!fs.existsSync(file)) return { missing: true };
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  const hash = spawnSync(process.execPath, [path.join(__dirname, 'raw-hash.mjs'), file], { env, encoding: 'utf8', timeout: 170000 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'justjpeg-selftest-'));
  try {
    const copy = path.join(dir, 'x.dng');
    fs.copyFileSync(file, copy);
    const cli = spawnSync(process.execPath, [path.join(__dirname, '..', 'src', 'cli.mjs'), copy], { env, encoding: 'utf8', timeout: 170000 });
    const out = path.join(dir, 'x.jpg');
    return {
      hash: hash.status === 0 ? JSON.parse(hash.stdout) : null,
      hashError: hash.status === 0 ? null : (hash.stderr || '').slice(-300),
      cliStatus: cli.status,
      cliError: (cli.stderr || '').slice(-300),
      cliBytes: fs.existsSync(out) ? fs.statSync(out).size : 0,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

ipcMain.handle('save', (_e, { name, bytes }) => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, path.basename(name)), Buffer.from(bytes));  // a fixture in a subfolder saves flat
  return true;
});

ipcMain.handle('report', (_e, rows) => {
  let failures = 0;
  console.log('\n  RESULT   FILE               OUT    DIMENSIONS      SIZE      NOTES');
  console.log('  ' + '-'.repeat(76));
  for (const r of rows) {
    if (!r.ok) failures++;
    const status = r.ok ? ' pass  ' : ' FAIL  ';
    console.log(
      `  ${status}  ${r.file.padEnd(17)}  ${String(r.format).padEnd(5)}  ` +
      `${String(r.dims || '-').padEnd(14)}  ${String(r.size || '-').padEnd(8)}  ${r.notes || ''}`,
    );
  }
  console.log('  ' + '-'.repeat(76));
  console.log(`  ${rows.length - failures}/${rows.length} passed\n`);
  if (process.env.CI && MISSING.length) {
    console.log(`  FAIL  fixtures missing in CI: ${[...new Set(MISSING)].join(', ')}\n`);
    failures += MISSING.length;
  }
  app.exit(failures ? 1 : 0);
});

app.whenReady().then(() => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'selftest-preload.cjs'),
      contextIsolation: true,
    },
  });
  win.loadFile(path.join(__dirname, 'selftest.html'));
  win.webContents.on('console-message', (_e, _level, message) => {
    if (message.startsWith('[test]')) console.log('   ', message.slice(6).trim());
  });
});

// Do not let a hung decode wedge CI forever.
setTimeout(() => {
  console.error('\n  Self-test timed out after 5 minutes.\n');
  app.exit(2);
}, 5 * 60 * 1000);
