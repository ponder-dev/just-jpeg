'use strict';
/*
 * The real app, offscreen: the bundled main and preload (app/), the real page,
 * the real conversion worker, and a REAL folder dropped on the window through
 * Chromium's own drop path (CDP Input.dispatchDragEvent), the path a drag from
 * Finder, Explorer or a Linux file manager takes. Nothing is stood in for but
 * the system's folder chooser, which cannot be driven.
 *
 *   npm run bundle && node scripts/electron.cjs test/window.test.cjs
 */

const { app, BrowserWindow, dialog } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'justjpeg-window-')));
// Its own user data: another running copy cannot take the single-instance lock.
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'justjpeg-window-userdata-'));
app.setPath('userData', USER_DATA);
// Clean-up never throws: on Windows the app still holds its user data while it
// exits, and an error thrown here became a dialog box that waited for a click,
// so the test never ended (the "hang" in the packaged Windows app).
process.on('exit', () => {
  for (const d of [ROOT, ROOT + '-picked', USER_DATA]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* left for the system's temp clean-up */ }
  }
});
process.env.JUSTJPEG_TEST_OFFSCREEN = '1';

const FIXTURES = path.join(__dirname, 'fixtures');
const photo = (...to) => { fs.mkdirSync(path.dirname(path.join(...to)), { recursive: true }); fs.copyFileSync(path.join(FIXTURES, 'sample.png'), path.join(...to)); };

// The folder chooser answers from here; what it was asked for is kept.
const asked = [];
let answer = [];
dialog.showOpenDialog = async (...args) => {
  asked.push(args.at(-1));
  return { canceled: !answer.length, filePaths: answer };
};

require('../app/main.cjs');

let failures = 0;
function check(ok, what, got) {
  if (!ok) failures++;
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${what}${ok || got === undefined ? '' : `  (got ${JSON.stringify(got)})`}`);
}
const names = (dir) => fs.readdirSync(dir).sort();
const tree = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tree(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))])).sort();

app.whenReady().then(async () => {
  let win = null;
  for (let i = 0; i < 100 && !win; i++) { win = BrowserWindow.getAllWindows()[0]; if (!win) await new Promise((r) => setTimeout(r, 50)); }
  if (!win) throw new Error('the app opened no window');
  const problems = [];
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) problems.push(message); });
  await new Promise((r) => { if (win.webContents.isLoading()) win.webContents.once('did-finish-load', r); else r(); });
  await new Promise((r) => setTimeout(r, 800));

  const js = (code) => win.webContents.executeJavaScript(code);
  const until = async (cond, s, what) => {
    const end = Date.now() + s * 1000;
    while (!(await js(cond))) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const text = (sel) => js(`(document.querySelector(${JSON.stringify(sel)}) || {}).textContent`);
  const shown = (sel) => js(`(() => { const n = document.querySelector(${JSON.stringify(sel)}); return !!(n && n.offsetParent); })()`);
  const runState = () => js("document.getElementById('run').dataset.state");

  // A real drop of paths onto the window.
  const cdp = win.webContents.debugger;
  cdp.attach('1.3');
  // Waits for the file row to change (a drop can land on a window that already
  // holds something: on Windows and Linux the Choose a folder step leaves one in).
  async function drop(...paths) {
    const was = await js("(() => { const n = document.querySelector('#start.landed .k-file'); return n ? n.textContent : ''; })()");
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      await cdp.sendCommand('Input.dispatchDragEvent', { type, x: 360, y: 300, data: { items: [], files: paths, dragOperationsMask: 1 } });
    }
    await until(`(() => { const n = document.querySelector('#start.landed .k-file'); return (n && n.textContent !== ${JSON.stringify(was)}) || document.querySelector('#start .k-error').textContent !== ''; })()`, 20, 'the drop to land');
  }
  async function convert() {
    await js("document.getElementById('btn-convert').click()");
    await until("document.getElementById('run').dataset.state === 'done' || document.getElementById('run').dataset.state === 'failed'", 120, 'the run to end');
  }
  const startAgain = () => js("document.querySelector('#run .k-run-done-actions .linky').click()");

  console.log('\n  Just JPEG, the real app');

  // The start screen, by platform: a Mac's one picker takes files and folders;
  // Windows and Linux get Choose a folder beside a main button that says photos.
  const mac = process.platform === 'darwin';
  check(await text('#btn-choose') === (mac ? 'Choose photos or folders' : 'Choose photos'), 'the main button says what it picks on this platform', await text('#btn-choose'));
  check(mac ? !(await js("!!document.getElementById('btn-choose-folder')")) : await shown('#btn-choose-folder'), mac ? 'a Mac has no Choose a folder button' : 'Windows and Linux have Choose a folder');
  if (!mac) check(await text('#btn-choose-folder') === 'Choose a folder', 'and it is called Choose a folder');
  check(await text('#start .k-zone-say') === 'Drop your photos or a folder here', 'the drop line says a folder can be dropped');

  // The title strip: under the traffic lights on a Mac; on Windows and Linux
  // the app's own dark title bar, the system buttons' height, with the
  // window's name in it (the kit's frame, decided 2026-11-20). A pre-release
  // build says so beside its coming version, in the title too.
  const version = require('../package.json').version;
  const strip = await js(`(() => { const t = document.querySelector('.titlebar'); const n = t && t.querySelector('.k-titlebar-name');
    return t ? { h: t.offsetHeight, name: n ? n.textContent : null, title: document.title, shown: (document.querySelector('.k-version') || {}).textContent } : null; })()`);
  if (mac) check(strip && strip.h === 28 && strip.name === null, 'on a Mac the strip sits under the traffic lights', strip);
  else check(strip && strip.h === 32 && strip.name === strip.title && /^Just JPEG/.test(strip.title), 'the app draws its own title bar with its name', strip);
  const label = /-/.test(version) ? `${version.split('-')[0]} (pre-release)` : version;
  check(strip && strip.shown === label && strip.title === `Just JPEG ${label}`, 'the version beside the name and in the title says pre-release on a pre-release build', strip);

  // What each picker asks the system for.
  answer = [];
  await js('window.ponder.pickInput()');
  await js('window.ponder.pickFolder()');
  check(JSON.stringify(asked[0].properties) === JSON.stringify(mac ? ['openFile', 'openDirectory', 'multiSelections'] : ['openFile', 'multiSelections']), 'the photo picker takes files (and folders on a Mac)', asked[0].properties);
  check(JSON.stringify(asked[1].properties) === JSON.stringify(['openDirectory', 'multiSelections']), 'the folder picker takes folders only', asked[1].properties);
  if (!mac) {
    // Beside the root, not in it: the parent-folder drop later counts what the root holds.
    const holder = path.join(ROOT + '-picked', 'picked');
    photo(holder, 'p.png');
    answer = [holder];
    await js("document.getElementById('btn-choose-folder').click()");
    await until("document.getElementById('start').classList.contains('landed')", 20, 'Choose a folder to bring a folder in');
    check(await text('#start .k-file-name') === 'picked', 'Choose a folder brings the folder in', await text('#start .k-file-name'));
    await js("document.querySelector('#start .k-file .linky, #btn-change') && document.getElementById('btn-change').click()");
    answer = [];
  }

  // A real folder dropped: nested photos, a note, and a Mac's ._ file.
  const holiday = path.join(ROOT, 'Holiday');
  photo(holiday, 'beach.png');
  photo(holiday, 'trip', 'hike.png');
  // Already a JPEG: copied into the results folder as it is, so it is complete.
  fs.copyFileSync(path.join(FIXTURES, 'plain.jpg'), path.join(holiday, 'sunset.jpg'));
  fs.writeFileSync(path.join(holiday, 'notes.txt'), 'not a photo');
  fs.writeFileSync(path.join(holiday, '._beach.png'), 'apple double');
  const before = tree(holiday);
  // A results folder of an earlier run, inside the one dropped, is passed over.
  photo(holiday, 'Old (JPEG)', 'old.png');

  await drop(holiday);
  check(await text('#start .k-file-name') === 'Holiday', 'a dropped folder comes in by its name', await text('#start .k-file-name'));
  const facts = await text('#start .k-file-facts');
  check(/^3 photos · /.test(facts), 'only its photos count: not the note, the ._ file or an earlier results folder', facts);
  check(await shown('#where-field'), 'Save next to the originals instead is offered with a folder in');
  check(await js("document.getElementById('beside').checked") === false, 'and it is off by default');
  check(await text('#output-label') === 'In a new folder beside the original', 'Save to says a new folder', await text('#output-label'));
  check(/Holiday \(JPEG\)/.test(await text('#where-hint')), 'the hint says where they go otherwise', await text('#where-hint'));

  // A short window (an 800x600 screen leaves about 520 for the page): the
  // settings run past the fold, and Convert stays in view at the foot instead
  // of going below it (decided 2026-11-20).
  {
    const was = win.getContentSize();
    const least = win.getMinimumSize();
    win.setMinimumSize(320, 320);
    win.setContentSize(720, 520);
    await new Promise((r) => setTimeout(r, 400));
    const small = await js(`(() => { const app = document.getElementById('app');
      const b = document.getElementById('btn-convert').getBoundingClientRect();
      return { bottom: Math.round(b.bottom), top: Math.round(b.top), view: Math.round(Math.min(innerHeight, app.getBoundingClientRect().bottom)), scrolls: app.scrollHeight > app.clientHeight }; })()`);
    win.setMinimumSize(...least);
    win.setContentSize(...was);
    await new Promise((r) => setTimeout(r, 300));
    check(small.scrolls, 'a short window makes the settings run past the fold', small);
    check(small.bottom <= small.view && small.top >= 0, 'in a short window Convert stays in view', small);
  }

  await convert();
  check(await runState() === 'done', 'the run ends done', await runState());
  const into = path.join(ROOT, 'Holiday (JPEG)');
  check(await text('#run .k-run-done-where') === 'Saved 3 files in Holiday (JPEG)', 'the done card says where they went', await text('#run .k-run-done-where'));
  check(JSON.stringify(tree(into)) === JSON.stringify(['beach.jpg', 'sunset.jpg', path.join('trip', 'hike.jpg')]), 'results are in the new folder, subfolders mirrored, names kept with .jpg', tree(into));
  check(fs.readFileSync(path.join(into, 'sunset.jpg')).equals(fs.readFileSync(path.join(FIXTURES, 'plain.jpg'))), 'a photo already a JPEG is copied in as it is');
  check(await text('#run .k-run-done-title') === 'Done. 2 photos converted, 1 already JPEG, copied as they are', 'the done card says how many were converted and how many were already fine', await text('#run .k-run-done-title'));
  check(JSON.stringify(tree(holiday)) === JSON.stringify([...before, path.join('Old (JPEG)', 'old.png')].sort()), 'the folder itself is untouched');
  check(await text('#run .k-run-done-actions .btn') === 'Show me the folder', 'the button says Show me the folder', await text('#run .k-run-done-actions .btn'));

  // Again: a taken name gets " 2", and the first results folder is left alone.
  await startAgain();
  await drop(holiday);
  await convert();
  check(await text('#run .k-run-done-where') === 'Saved 3 files in Holiday (JPEG) 2', 'a second run goes in Holiday (JPEG) 2', await text('#run .k-run-done-where'));
  check(fs.existsSync(path.join(ROOT, 'Holiday (JPEG) 2', 'trip', 'hike.jpg')) && tree(into).length === 3, 'and the first results are untouched');

  // Dropped with its results folder beside it, from the parent: passed over.
  await startAgain();
  await drop(ROOT);
  check(/^3 photos · /.test(await text('#start .k-file-facts')), 'the results folders beside are never taken in again from the parent (only Holiday\'s own 3)', await text('#start .k-file-facts'));
  await startAgain();

  // Save next to the originals instead: kept, and results sit beside each original.
  await drop(holiday);
  await js("document.getElementById('beside').click()");
  check(/beside its original/.test(await text('#where-hint')), 'ticking it changes the hint', await text('#where-hint'));
  await convert();
  check((await text('#run .k-run-done-where')).startsWith('Saved next to the originals in Holiday'), 'the done card says they went next to the originals', await text('#run .k-run-done-where'));
  check(!fs.existsSync(path.join(holiday, 'sunset 2.jpg')) && (await text('#run .k-run-done-title')).includes('1 skipped'), 'beside the originals nothing is copied: the JPEG is left alone, as ever', await text('#run .k-run-done-title'));
  check(fs.existsSync(path.join(holiday, 'beach.jpg')) && fs.existsSync(path.join(holiday, 'trip', 'hike.jpg')), 'each result is beside its original');
  check(!fs.existsSync(path.join(ROOT, 'Holiday (JPEG) 3')), 'and no new results folder was made');
  check(await text('#run .k-run-done-actions .btn') === 'Show me the file', 'the button says Show me the file');
  check(await js("JSON.stringify(localStorage).includes('justjpeg')"), 'the choice is kept');
  await startAgain();
  // Clear what the beside run left, so the next step starts from the originals.
  fs.rmSync(path.join(holiday, 'beach.jpg'));
  fs.rmSync(path.join(holiday, 'trip', 'hike.jpg'));
  await drop(holiday);
  check(await js("document.getElementById('beside').checked"), 'and still ticked on the next folder');
  await js("document.getElementById('beside').click()");
  await startAgain();

  // A chosen output folder wins, with the folder's subfolders mirrored inside.
  const chosen = path.join(ROOT, 'Chosen');
  fs.mkdirSync(chosen);
  answer = [chosen];
  await drop(holiday);
  await js("document.getElementById('btn-output').click()");
  await until(`document.getElementById('output-label').textContent === ${JSON.stringify(chosen)}`, 10, 'the chosen folder');
  check(await js("document.getElementById('beside').disabled"), 'with a folder chosen, the tick is off the table');
  await convert();
  check(await text('#run .k-run-done-where') === `Saved to ${chosen}`, 'the done card names the chosen folder', await text('#run .k-run-done-where'));
  check(JSON.stringify(tree(chosen)) === JSON.stringify(['beach.jpg', 'sunset.jpg', path.join('trip', 'hike.jpg')]), 'a chosen folder wins, subfolders mirrored inside', tree(chosen));
  check(!fs.existsSync(path.join(ROOT, 'Holiday (JPEG) 3')), 'and no results folder is made');
  await startAgain();
  answer = [];

  // A file dropped on its own: beside it, no folder, and no tick offered.
  const single = path.join(ROOT, 'Single');
  photo(single, 'one.png');
  await drop(path.join(single, 'one.png'));
  check(!(await shown('#where-field')), 'a file on its own offers no folder choice');
  await convert();
  check(fs.existsSync(path.join(single, 'one.jpg')) && !fs.existsSync(path.join(ROOT, 'Single (JPEG)')), 'its result is beside it');
  await startAgain();

  // "Replace it" replaces only what Just JPEG made: its own one.jpg goes, a real
  // photo with the name stays and the result is " 2".
  check(/only files Just JPEG made/.test(await js("document.querySelector('#existing option[value=overwrite]').textContent")), 'the Replace it option says it replaces only files Just JPEG made');
  photo(single, 'two.png');
  fs.copyFileSync(path.join(FIXTURES, 'plain.jpg'), path.join(single, 'two.jpg'));
  const ownBefore = fs.readFileSync(path.join(single, 'one.jpg'));
  await js("(() => { const s = document.getElementById('existing'); s.value = 'overwrite'; s.dispatchEvent(new Event('change', { bubbles: true })); })()");
  await drop(path.join(single, 'one.png'));
  await js("(() => { const s = document.getElementById('existing'); s.value = 'overwrite'; })()");
  await convert();
  check(!fs.existsSync(path.join(single, 'one 2.jpg')) && fs.existsSync(path.join(single, 'one.jpg')), 'Replace it replaces a file Just JPEG made: no one 2.jpg', names(single));
  await startAgain();
  await drop(path.join(single, 'two.png'));
  await js("document.getElementById('existing').value = 'overwrite'");
  await convert();
  check(fs.readFileSync(path.join(single, 'two.jpg')).equals(fs.readFileSync(path.join(FIXTURES, 'plain.jpg'))) && fs.existsSync(path.join(single, 'two 2.jpg')), 'Replace it keeps a real photo with the same name and writes two 2.jpg', names(single));
  void ownBefore;
  await startAgain();

  // A file named on its own that is not a photo is not taken.
  await drop(path.join(holiday, 'notes.txt'));
  check(/^No photos in there/.test(await text('#start .k-error')), 'a lone file of a kind it does not take is refused', await text('#start .k-error'));
  // A folder with no photos in it.
  const bare = path.join(ROOT, 'Bare');
  fs.mkdirSync(bare);
  fs.writeFileSync(path.join(bare, 'a.txt'), 'x');
  await drop(bare);
  check(/^No photos in there/.test(await text('#start .k-error')), 'a folder with no photos says so', await text('#start .k-error'));

  check(problems.length === 0, 'no errors in the page', problems);
  cdp.detach();
  console.log(`\n  ${failures ? `${failures} FAILED` : 'all passed'}\n`);
  app.exit(failures ? 1 : 0);
}).catch((err) => {
  console.error(`\n  window test: ${err.stack || err.message}\n`);
  app.exit(1);
});

setTimeout(() => { console.error('\n  Window test timed out after 4 minutes.\n'); app.exit(2); }, 4 * 60 * 1000);
