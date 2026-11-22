// Drives the real window, built from the kit, through a whole run: the start
// screen, photos landing, the run part under Convert (working, the queue,
// done), Start again, and a run that fails as a whole. The page and the
// conversion worker are the bundle's own (app/renderer); only the bridge to
// the disk is a stand-in (test/ui-preload.cjs), answered here from the
// fixtures, with outputs written to a temporary folder.
//
//   npm run bundle && node scripts/electron.cjs test/ui.test.cjs

const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FIXTURES = path.join(__dirname, 'fixtures');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'justjpeg-ui-'));
// Never throws: in Electron on Windows an error here is a dialog that waits for a click.
process.on('exit', () => { try { fs.rmSync(OUT, { recursive: true, force: true }); } catch { /* left for the system's temp clean-up */ } });

// Two real photos and one file that is not a photo at all.
const BAD = path.join(OUT, 'broken.jpg');
fs.writeFileSync(BAD, 'not a picture');
const INPUT = [path.join(FIXTURES, 'sample.png'), path.join(FIXTURES, 'withexif.jpg'), BAD];

// Copy skill reads the skill the bundle carries, as main does (app:skill).
const SKILL = path.join(__dirname, '..', 'app', 'skill', 'SKILL.md');
const opened = [];
ipcMain.handle('ui:skill', () => fs.readFileSync(SKILL, 'utf8'));
ipcMain.handle('ui:open', (_e, url) => { opened.push(url); });

let failWrites = false;
let emptyScan = false;
let includeBad = true;       // the damaged file is among the photos found
let failStart = false;       // the run cannot be set up
const skipNames = new Set(); // files the plan skips, as a taken name would
let gate = null;             // while set, a write waits: a run held mid-flight
let writeCalls = 0;
const written = [];

ipcMain.handle('ui:pick', () => [FIXTURES]);
ipcMain.handle('ui:pickOutput', () => OUT);
ipcMain.handle('ui:startRun', () => { if (failStart) throw new Error('the run could not be set up'); });
ipcMain.handle('ui:scan', () => (emptyScan ? [] : includeBad ? INPUT : INPUT.slice(0, 2)).map((p) => ({ path: p, name: path.basename(p), size: fs.statSync(p).size })));
ipcMain.handle('ui:read', (_e, p) => { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
ipcMain.handle('ui:plan', (_e, { sourcePath }) => (skipNames.has(path.basename(sourcePath))
  ? { action: 'skip', reason: 'exists', path: path.join(OUT, path.basename(sourcePath) + '.out.jpg') }
  : { action: 'write', path: path.join(OUT, path.basename(sourcePath) + '.out.jpg') }));
ipcMain.handle('ui:write', async (_e, { targetPath, bytes }) => {
  writeCalls++;
  if (gate) await gate;
  if (failWrites) throw new Error(`EACCES: permission denied, open '${targetPath}'`);
  fs.writeFileSync(targetPath, Buffer.from(bytes));
  written.push(targetPath);
  return true;
});

let failures = 0;
function check(ok, what, got) {
  if (!ok) failures++;
  console.log(`  ${ok ? 'pass' : 'FAIL'}  ${what}${ok || got === undefined ? '' : `  (got ${JSON.stringify(got)})`}`);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 720, height: 900, show: false,
    webPreferences: { preload: path.join(__dirname, 'ui-preload.cjs'), contextIsolation: true },
  });
  await win.loadFile(path.join(__dirname, '..', 'app', 'renderer', 'index.html'));
  const js = (code) => win.webContents.executeJavaScript(code);
  const until = async (cond, s, what) => {
    const end = Date.now() + s * 1000;
    while (!(await js(cond))) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const runState = () => js("document.getElementById('run').dataset.state");
  const shown = (sel) => js(`(() => { const n = document.querySelector(${JSON.stringify(sel)}); return !!(n && n.offsetParent); })()`);

  console.log('\n  The window, on the kit');

  // Opening: the start screen and nothing else.
  check(await js("document.querySelector('#start h1').textContent") === 'Just JPEG', 'the start screen names the tool');
  check(await js("document.querySelector('#start .k-zone-say').textContent") === 'Drop your photos or a folder here', 'the drop zone says what to drop');
  check(await shown('#btn-choose'), 'the choose button is on the start screen');
  check(!(await shown('.after-file')), 'no settings until photos are in');
  check(await js("document.querySelector('#footer').textContent.includes(Kit.PROMISE)"), "the footer carries the kit's promise");
  check(await js("[...document.querySelectorAll('svg')].every((s) => s.classList.contains('k-icon'))"), 'every icon is a kit icon');
  for (const gone of ['view-drop', 'view-settings', 'view-progress', 'view-done', 'btn-again', 'btn-clear'])
    check(await js(`!document.getElementById('${gone}')`), `the old ${gone} is gone`);

  // Use it with your assistant: Copy skill puts the tool's own SKILL.md on the
  // clipboard, and What's this? leads to the how-it-works page.
  const shipped = fs.readFileSync(path.join(__dirname, '..', 'agents', 'skills', 'justjpeg', 'SKILL.md'), 'utf8');
  check(fs.existsSync(SKILL) && fs.readFileSync(SKILL, 'utf8') === shipped, 'the bundle carries the skill as shipped in agents/');
  check(await shown('#start .k-skill'), 'the skill line is on the start screen');
  // A hidden window never has focus, and the system clipboard refuses a page
  // without it, so the page's clipboard is stood in for here: what reaches it
  // is what a person would paste.
  await js("Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied = t; } } })");
  await js("[...document.querySelectorAll('#start .k-skill .linky')].find((b) => b.textContent === 'Copy skill').click()");
  await until("[...document.querySelectorAll('#start .k-skill .linky')].some((b) => b.textContent !== 'Copy skill' && b.textContent !== \"What's this?\")", 10, 'Copy skill to answer');
  const copied = await js("[...document.querySelectorAll('#start .k-skill .linky')][0].textContent");
  check(copied === 'Copied' && (await js('window.__copied')) === shipped, 'Copy skill copies the SKILL.md text', copied);
  await js("[...document.querySelectorAll('#start .k-skill .linky')].find((b) => b.textContent === \"What's this?\").click()");
  await js("[...document.querySelectorAll('#start .k-skill-about .linky')].find((b) => b.textContent === 'How it works').click()");
  await new Promise((r) => setTimeout(r, 200));
  check(opened.at(-1) === 'https://ponderdev.com/tools/just-jpeg/how-it-works', "What's this? leads to the how-it-works page", opened);

  // A folder with no photos in it: said under the drop zone, nothing lands.
  emptyScan = true;
  await js("document.getElementById('btn-choose').click()");
  await until("document.querySelector('#start .k-error').textContent !== ''", 10, 'the no-photos line');
  const none = await js("document.querySelector('#start .k-error').textContent");
  check(/^No photos in there\. /.test(none), 'a folder with no photos says so under the drop zone', none);
  check(!(await js("document.getElementById('start').classList.contains('landed')")), 'and nothing lands');
  emptyScan = false;

  // Photos land: the file row and the settings, the estimate above Convert.
  await js("document.getElementById('btn-choose').click()");
  await until("document.getElementById('start').classList.contains('landed')", 10, 'the photos to land');
  check(await js("document.querySelector('#start .k-file-name').textContent") === 'fixtures', 'the file row names the folder', await js("document.querySelector('#start .k-file-name').textContent"));
  const facts = await js("document.querySelector('#start .k-file-facts').textContent");
  check(/^3 photos · [\d.]+ (KB|MB)$/.test(facts), 'the file row counts the photos and their size', facts);
  check(await shown('.after-file .k-section'), 'the settings come in');
  check(await js("document.querySelector('#start .k-error').textContent") === '', 'the no-photos line goes once photos land');
  check(/^Roughly /.test(await js("document.getElementById('plan-note').textContent")), 'the estimate sits above Convert');
  check(await runState() === 'idle', 'the run part is empty before a run');
  await js("document.querySelector('#seg-format button[data-value=\"png\"]').click()");
  check(!(await shown('#field-quality')), 'PNG hides the quality slider');
  await js("document.querySelector('#seg-format button[data-value=\"jpeg\"]').click()");
  check(await shown('#field-quality'), 'JPEG shows it again');

  // The run: working with its queue, then done, all on the settings screen.
  await js("document.getElementById('btn-convert').click()");
  check(await runState() === 'working', 'Convert starts the run part working', await runState());
  check(await js("document.getElementById('btn-convert').disabled"), 'Convert is off while it runs');
  check(await js("document.getElementById('btn-change').disabled"), 'Change is off while it runs');
  check(await js("document.querySelector('#run .k-run-what').textContent") === 'Converting to JPEG', 'it says what it is doing');
  check(await js("document.getElementById('plan-note').textContent") === '', 'the estimate gives way to the run');
  await until("document.getElementById('run').dataset.state !== 'working'", 120, 'the run to end');
  check(await runState() === 'done', 'the run ends done', await runState());
  check(await shown('.after-file .k-section'), 'the settings stay on screen after the run');
  const title = await js("document.querySelector('#run .k-run-done-title').textContent");
  check(title === 'Done. 2 photos converted, 1 could not be read', 'the done line counts what was converted and what failed', title);
  check(/^[\d.]+ (KB|MB) of JPEG in \d+ seconds?$/.test(await js("document.querySelector('#run .k-run-done-detail').textContent")), 'the done line says how much and how long');
  check(await js("document.querySelector('#run .k-run-done-where').textContent") === 'Saved next to the originals in fixtures', 'the done line says where');
  const rows = await js("[...document.querySelectorAll('#run .k-run-queue li')].map((li) => [li.dataset.q, li.querySelector('.k-q-name').textContent, li.querySelector('.k-q-note')?.textContent || ''])");
  check(rows.length === 3, 'the queue lists the three files', rows);
  const bad = rows.find((r) => r[1] === 'broken.jpg');
  check(bad && bad[0] === 'failed' && bad[2].length > 0, 'the file that could not be read is a failed row with its reason', bad);
  check(rows.filter((r) => r[0] === 'done').length === 2, 'the two photos are done rows');
  check(written.length === 2, 'two files were written', written.length);
  check(!(await js("document.querySelector('#run .k-run-done-actions .btn').hidden")), 'Show me the file is offered');
  check(!(await js("document.querySelector('#run .k-run-done').classList.contains('over')")), 'a run that converted is not marked as falling short');
  check(!(await js("document.getElementById('btn-change').disabled")), 'Change is back on');
  check(!(await js("document.getElementById('btn-convert').disabled")), 'Convert is back on');

  // Start again goes back to the start screen.
  await js("document.querySelector('#run .k-run-done-actions .linky').click()");
  check(!(await js("document.getElementById('start').classList.contains('landed')")), 'Start again goes back to the start screen');
  check(!(await shown('.after-file')), 'and the settings go');
  check(await runState() === 'idle', 'and the run part empties');

  // Nothing can be saved: one failure for the whole run, with Try again.
  failWrites = true;
  includeBad = false;
  await js("document.getElementById('btn-choose').click()");
  await until("document.getElementById('start').classList.contains('landed')", 10, 'the photos to land again');
  await js("document.getElementById('btn-convert').click()");
  await until("document.getElementById('run').dataset.state !== 'working'", 120, 'the failing run to end');
  check(await runState() === 'failed', 'a run that saves nothing fails as a whole', await runState());
  const message = await js("document.querySelector('#run .k-error').textContent");
  check(message === 'Just JPEG cannot save to fixtures. Choose another folder to save to.', 'the failure says what to do', message);
  check(await shown('#run .k-run-failed .btn'), 'Try again is offered');
  failWrites = false;
  await js("document.querySelector('#run .k-run-failed .btn').click()");
  await until("document.getElementById('run').dataset.state !== 'working'", 120, 'the retried run to end');
  check(await runState() === 'done', 'Try again runs it again', await runState());

  // The same, with a damaged photo among them: the run is not "cannot save"
  // as a whole, the done line counts each kind.
  await js("document.querySelector('#run .k-run-done-actions .linky').click()");
  failWrites = true;
  includeBad = true;
  await js("document.getElementById('btn-choose').click()");
  await until("document.getElementById('start').classList.contains('landed')", 10, 'the photos to land with a damaged one');
  await js("document.getElementById('btn-convert').click()");
  await until("document.getElementById('run').dataset.state !== 'working'", 120, 'the mixed run to end');
  check(await runState() === 'done', 'unreadable and unsaved together is a finished run, not a whole-run failure', await runState());
  const mixed = await js("document.querySelector('#run .k-run-done-title').textContent");
  check(/1 could not be read/.test(mixed) && /2 could not be saved/.test(mixed), 'and the line counts both kinds', mixed);
  failWrites = false;

  // After a run the estimate is back above Convert, for pressing it again.
  await js("document.querySelector('#run .k-run-done-actions .linky').click()");
  includeBad = false;
  await js("document.getElementById('btn-choose').click()");
  await until("document.getElementById('start').classList.contains('landed')", 10, 'the photos to land again');
  await js("document.getElementById('btn-convert').click()");
  await until("document.getElementById('run').dataset.state !== 'working'", 120, 'a run to end');
  check(/^Roughly /.test(await js("document.getElementById('plan-note').textContent")), 'after a run the estimate is back above Convert', await js("document.getElementById('plan-note').textContent"));

  // A drop on the settings replaces the photos, and says so.
  const drop = (name) => js(`(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], ${JSON.stringify(name)})); window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); })()`);
  await drop('new.jpg');
  await until("document.getElementById('plan-note').textContent.startsWith('Replaced')", 10, 'the replaced note');
  check(/^Replaced the 2 photos from before\. Roughly /.test(await js("document.getElementById('plan-note').textContent")), 'a drop on the settings says it replaced the photos', await js("document.getElementById('plan-note').textContent"));

  // Save to: a chosen folder, and the way back to the default.
  check(!(await shown('#btn-output-clear')), 'no way back while no folder is chosen');
  await js("document.getElementById('btn-output').click()");
  await until("document.getElementById('output-label').textContent === " + JSON.stringify(OUT), 10, 'the chosen folder');
  check(await shown('#btn-output-clear'), 'a chosen folder can be cleared');
  await js("document.getElementById('btn-output-clear').click()");
  check(await js("document.getElementById('output-label').textContent") === 'Next to each original', 'cleared, it is next to each original again');
  check(!(await shown('#btn-output-clear')), 'and the way back goes');
  check(await js("document.getElementById('output-label').classList.contains('k-dest-path')"), 'the path is a kit destination, cut short with an ellipsis');

  // PNG carries no photo details, and says so.
  await js("document.querySelector('#seg-format button[data-value=\"png\"]').click()");
  check(await js("document.getElementById('keep-metadata').disabled"), 'PNG turns Keep photo details off');
  check(/not carried over/.test(await js("document.getElementById('hint-format').textContent")), 'and the hint says why');
  await js("document.querySelector('#seg-format button[data-value=\"jpeg\"]').click()");
  check(!(await js("document.getElementById('keep-metadata').disabled")), 'JPEG turns it back on');
  check(/See-through/.test(await js("document.getElementById('hint-format').textContent")), 'with a PNG among the photos, JPEG says see-through parts turn white');

  // A skip is not a failure: its own mark, counted as skipped.
  skipNames.add('sample.png');
  await js("document.getElementById('btn-convert').click()");
  await until("document.getElementById('run').dataset.state !== 'working'", 120, 'the run with a skip to end');
  const skipRows = await js("[...document.querySelectorAll('#run .k-run-queue li')].map((li) => [li.dataset.q, li.querySelector('.k-q-name').textContent])");
  check(skipRows.find((r) => r[1] === 'sample.png')?.[0] === 'skipped', 'a skipped file has its own mark, not the failed one', skipRows);
  check(!skipRows.some((r) => r[0] === 'failed'), 'and no row is drawn as a failure', skipRows);
  check(/1 skipped/.test(await js("document.querySelector('#run .k-run-done-title').textContent")), 'the done line counts it as skipped');
  skipNames.clear();

  // Held mid-run: the choices that decide where it saves are held, a drop is
  // refused and says so, and Cancel on the last files under way ends it as Done.
  let release;
  gate = new Promise((resolve) => { release = resolve; });
  writeCalls = 0;
  await js("document.getElementById('btn-convert').click()");
  await until('true', 1, 'a tick');
  const waitForWrites = async () => { for (let i = 0; i < 300 && writeCalls < 2; i++) await new Promise((r) => setTimeout(r, 100)); };
  await waitForWrites();
  check(writeCalls === 2, 'both photos are in flight', writeCalls);
  check(await js("document.getElementById('btn-output').disabled"), 'Save to is held while it runs');
  await js("window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: (() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'z.jpg')); return dt; })(), bubbles: true }))");
  check(await js("document.querySelector('.k-veil').hidden"), 'no veil while a run goes');
  const factsBefore = await js("document.querySelector('#start .k-file-facts').textContent");
  await drop('late.jpg');
  check(await js("document.getElementById('plan-note').textContent") === 'Wait for this run to finish first.', 'a drop during a run is refused out loud', await js("document.getElementById('plan-note').textContent"));
  check(await js("document.querySelector('#start .k-file-facts').textContent") === factsBefore, 'and nothing was added');
  await js("document.querySelector('#run .k-run-cancel').click()");
  release();
  gate = null;
  await until("document.getElementById('run').dataset.state !== 'working'", 120, 'the held run to end');
  const ended = await js("document.querySelector('#run .k-run-done-title').textContent");
  check(/^Done\. /.test(ended), 'Cancel with every file already under way is still a Done run, not Stopped', ended);
  check(!(await js("document.getElementById('btn-output').disabled")), 'Save to is free again');

  // The run cannot be set up: the failure stands alone, with no queue under it.
  failStart = true;
  await js("document.getElementById('btn-convert').click()");
  await until("document.getElementById('run').dataset.state === 'failed'", 20, 'the failure');
  check(/^The photos could not be converted/.test(await js("document.querySelector('#run .k-error').textContent")), 'a run that cannot start says so');
  check(!(await shown('#run .k-run-queue')), 'and leaves no half-run queue under it');
  failStart = false;

  // Start again returns the settings to the usual ones.
  await js("document.querySelector('#seg-format button[data-value=\"png\"]').click()");
  await js("document.getElementById('size').value = '1200'");
  await js("document.getElementById('max-quality').checked = true");
  await js("document.querySelector('#run .k-run-failed .btn').click()");
  await until("document.getElementById('run').dataset.state !== 'working'", 120, 'the retry to end');
  await js("document.querySelector('#run .k-run-done-actions .linky').click()");
  check(await js("document.querySelector('#seg-format [aria-pressed=\"true\"]').dataset.value") === 'jpeg'
    && await js("document.getElementById('size').value") === '0'
    && !(await js("document.getElementById('max-quality').checked")), 'Start again returns the settings to the usual ones');

  console.log(`\n  ${failures ? `${failures} FAILED` : 'all passed'}\n`);
  app.exit(failures ? 1 : 0);
}).catch((err) => {
  console.error(`\n  ui test: ${err.message}\n`);
  app.exit(1);
});

setTimeout(() => { console.error('\n  UI test timed out after 3 minutes.\n'); app.exit(2); }, 3 * 60 * 1000);
