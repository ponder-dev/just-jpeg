// Runs the real conversion worker inside real Electron against the fixtures,
// then prints a pass/fail table. This is the check that matters, because the
// worker depends on WASM and OffscreenCanvas, neither of which exist in plain
// Node.
//
//   npx electron test/selftest.cjs

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

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
ipcMain.handle('cases', () => CASES.filter((c) => {
  const present = fs.existsSync(path.join(FIXTURES, c.file));
  if (!present) console.log(`    skipping ${c.file}: not downloaded, run scripts/fetch-fixtures.mjs`);
  return present;
}));

ipcMain.handle('save', (_e, { name, bytes }) => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), Buffer.from(bytes));
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
