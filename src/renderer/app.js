// UI controller. Owns the worker pool and walks the queue; every filesystem
// touch goes through window.ponder. The page is built from the kit (Kit, from
// kit/kit.js): the start screen, the file row, the settings, and the run part
// under the Convert button, which shows working, the queue, done and failed.
// The window stays on the settings during and after a run.

import { skipText } from '../engine.js';

const $ = (id) => document.getElementById(id);
const Kit = window.Kit;

const state = {
  files: [],
  // What the photos came in as: a folder's name when one folder was chosen,
  // else null. The file row and the done line name it.
  folderName: null,
  outputDir: null,
  cores: 4,
  running: false,
  cancelled: false,
  repaint: null,  // redraws the run part while a run is going
  results: null,
};

let start;      // Kit.start: the start screen and the file row
let run;        // Kit.run: working, the queue, done, failed
let format;     // Kit.segmented: JPEG or PNG
let veil;       // Kit.veil: a drop anywhere on the window

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function formatDuration(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '';
  const s = Math.round(seconds);
  if (s < 60) return `${s} second${s === 1 ? '' : 's'}`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// ipcRenderer.invoke wraps a handler's error as "Error invoking remote
// method 'x': Error: <message>"; only the message is ours to show.
function plainError(err) {
  const text = String((err && err.message) || err || '');
  return text.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '');
}

function plural(n, word) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

// A folder's results go into a new folder beside it ("Holiday (JPEG)") unless
// "Save next to the originals instead" is ticked, or an output folder is chosen.
const settings = Kit.store('justjpeg', { beside: false });

// A Mac's picker takes files and folders in one window; Windows and Linux have
// Choose a folder as a second button, so the main button says photos only there.
const CHOOSE_LABEL = window.ponder.folderButton ? 'Choose photos' : 'Choose photos or folders';

const baseName = (p) => String(p).replace(/[\\/]+$/, '').split(/[\\/]/).pop();
const formatName = (f) => (f === 'png' ? 'PNG' : 'JPEG');

// ------------------------------------------------------------ picking files ---

async function addPaths(paths) {
  if (!paths || !paths.length || state.running) return;
  const choose = start.buttons.choose;
  const folder = start.buttons.also;
  start.error('');
  choose.disabled = true;
  if (folder) folder.disabled = true;
  choose.textContent = 'Looking for photos...';
  try {
    const found = await window.ponder.scan(paths);
    if (!found.length) {
      start.error('No photos in there. Just JPEG looks for HEIC, HEIF, DNG and camera RAW, JPEG, PNG, TIFF and WebP files.');
      return;
    }
    const replaced = state.files.length;
    state.files = found;
    // One folder in: every photo found sits under it, and it is not itself a photo.
    const only = paths.length === 1 ? paths[0] : null;
    state.folderName = only && !found.some((f) => f.path === only) ? baseName(only) : null;
    landed();
    // A drop on the settings takes the place of what was there; say so.
    if (replaced) {
      const note = $('plan-note');
      note.textContent = `Replaced the ${plural(replaced, 'photo')} from before. ${note.textContent}`.trim();
    }
  } finally {
    choose.disabled = false;
    if (folder) folder.disabled = false;
    choose.textContent = CHOOSE_LABEL;
  }
}

async function pickAndAdd() {
  if (state.running) return;
  await addPaths(await window.ponder.pickInput());
}

async function pickFolderAndAdd() {
  if (state.running) return;
  await addPaths(await window.ponder.pickFolder());
}

function landed() {
  const total = state.files.reduce((sum, f) => sum + f.size, 0);
  const count = plural(state.files.length, 'photo');
  const name = state.folderName || (state.files.length === 1 ? state.files[0].name : count);
  start.landed({ name, facts: `${count} · ${formatBytes(total)}` });
  run.reset();
  state.results = null;
  updateWhere();
  updateFormatHint();
  updatePlanNote();
}

function updatePlanNote() {
  // Not during a run: then the run part says how long. Before one and after
  // one it is the estimate for pressing Convert again.
  if (state.running) { $('plan-note').textContent = ''; return; }
  // A HEIC takes roughly this long per worker; replaced by a real
  // measurement after the first run.
  const perFile = window.__ponderPerFileMs || 1800;
  const slower = $('max-quality').checked ? 2.4 : 1;
  const seconds = (state.files.length * perFile * slower) / Math.max(1, poolSize()) / 1000;
  $('plan-note').textContent = state.files.length
    ? `Roughly ${formatDuration(seconds)}`
    : '';
}

// Save to: where the results go. A chosen output folder wins; otherwise a
// folder's results go in a new folder beside it unless Save next to the
// originals instead is ticked. The tick shows only with a folder in.
// The path is long; the label cuts it short with an ellipsis and keeps it whole as its tooltip.
function setOutputLabel(text) {
  $('output-label').textContent = text;
  $('output-label').title = text;
}

function updateWhere() {
  updateOutputButtons();
  const from = state.files.find((f) => f.from);
  $('where-field').hidden = !from;
  if (!from) { setOutputLabel(state.outputDir || 'Next to each original'); return; }
  const chosen = Boolean(state.outputDir);
  $('beside').checked = settings.get('beside');
  $('beside').disabled = chosen;
  const beside = $('beside').checked && !chosen;
  setOutputLabel(chosen ? state.outputDir : beside ? 'Next to each original' : 'In a new folder beside the original');
  $('where-hint').textContent = chosen
    ? 'Your chosen folder is used, with the folder\'s own subfolders inside it.'
    : beside
      ? 'Each one is saved beside its original.'
      : `Otherwise they go in a new folder beside it, ${baseName(from.from)} (JPEG), and the folder itself is left as it is.`;
}

// -------------------------------------------------------------- worker pool ---

function poolSize() {
  // Each worker can hold a full uncompressed frame, so this is a memory
  // decision as much as a speed one. Past six the disk and RAM dominate.
  return Math.max(1, Math.min(6, state.cores - 1));
}

function createWorker() {
  const worker = new Worker(new URL('./convert.worker.js', import.meta.url), { type: 'module' });
  worker.pending = new Map();
  worker.nextId = 1;
  worker.onmessage = ({ data }) => {
    const entry = worker.pending.get(data.id);
    if (!entry) return;
    worker.pending.delete(data.id);
    data.ok ? entry.resolve(data) : entry.reject(new Error(data.error));
  };
  worker.onerror = (e) => {
    for (const { reject } of worker.pending.values()) reject(new Error(e.message || 'Worker crashed'));
    worker.pending.clear();
  };
  worker.run = (job, transfer) => new Promise((resolve, reject) => {
    const id = worker.nextId++;
    worker.pending.set(id, { resolve, reject });
    worker.postMessage({ id, job }, transfer);
  });
  return worker;
}

// ------------------------------------------------------------------ the run ---

// While a run goes, the choices that decide where it saves are held, so the
// label under Save to never names a folder the run is not using.
function setSettingsLocked(on) {
  $('btn-output').disabled = on;
  $('btn-output-clear').disabled = on;
  $('beside').disabled = on || Boolean(state.outputDir);
}

// Save to: the button that takes a chosen folder back to the default.
function updateOutputButtons() {
  $('btn-output-clear').hidden = !state.outputDir;
}

// The hint under Convert to: what the chosen format does with the photos.
const SEE_THROUGH = /\.(png|webp|tiff?|gif)$/i;
function updateFormatHint() {
  const png = format.get() === 'png';
  $('field-quality').hidden = png;
  // Photo details are a JPEG thing; a PNG carries none, so the box says so.
  $('keep-metadata').disabled = png;
  $('keep-metadata-label').classList.toggle('muted', png);
  $('hint-format').textContent = png
    ? 'Lossless and larger. Photo details are not carried over, so there is no quality to set.'
    : 'Best for photos. Keeps date, camera and location.'
      + (state.files.some((f) => SEE_THROUGH.test(f.name)) ? ' See-through parts of PNG, WebP and TIFF files turn white.' : '');
}

function readSettings() {
  return {
    format: format.get(),
    quality: Number($('quality').value),
    maxDim: Number($('size').value) || 0,
    keepMetadata: $('keep-metadata').checked,
    keepDate: $('keep-date').checked,
    maxQuality: $('max-quality').checked,
    onExisting: $('existing').value,
    // Read once, so choosing another folder during a run cannot split it.
    outDir: state.outputDir,
    beside: settings.get('beside'),
  };
}

// The queue shows a window of rows around where the run is, the files before
// it that failed or were skipped (each keeping its reason; a skip is a choice,
// not a fault, so it has its own plain mark and is not counted as a failure), and nothing more,
// so a folder of thousands stays a short list. While it runs only the latest
// few failures stay above the window, so the files under way stay in sight;
// once it ends, every failure is listed (up to a limit).
const QUEUE_BEFORE = 4;
const FAILED_WHILE_RUNNING = 3;
const FAILED_AT_END = 200;

function queueRows(files, marks, cursor, after, keepFailed) {
  const from = Math.max(0, cursor - QUEUE_BEFORE);
  const to = Math.min(files.length, cursor + after);
  const rows = [];
  for (let i = 0; i < from; i++) {
    if (marks[i].state === 'failed' || marks[i].state === 'skipped') rows.push(i);
  }
  const failedBefore = rows.slice(-keepFailed);
  const windowRows = [];
  for (let i = from; i < to; i++) windowRows.push(i);
  return [...failedBefore, ...windowRows].map((i) => ({ name: files[i].name, ...marks[i] }));
}

async function convertAll() {
  const settings = readSettings();
  const files = state.files;
  const total = files.length;
  const what = `Converting to ${formatName(settings.format)}`;

  state.running = true;
  state.cancelled = false;
  state.results = null;
  $('btn-convert').disabled = true;
  start.buttons.change.disabled = true;
  if (start.buttons.changeAlso) start.buttons.changeAlso.disabled = true;
  setSettingsLocked(true);
  $('plan-note').textContent = '';

  // One mark per file: waiting, working, done or failed, with a reason.
  const marks = files.map(() => ({ state: 'waiting' }));
  const results = { converted: 0, skipped: 0, failed: 0, unreadable: 0, unsaved: 0, skipReasons: new Set(), copied: 0, bytesOut: 0, firstOutput: null, folders: new Set(), besideCount: 0 };

  let next = 0;
  let finished = 0;
  let left = '';
  const started = performance.now();

  const firstUnfinished = () => {
    const i = marks.findIndex((m) => m.state === 'waiting' || m.state === 'working');
    return i === -1 ? total : i;
  };
  const paint = () => {
    // The file named under the bar is the earliest one still being worked on,
    // the same one the queue marks as working first.
    const working = marks.findIndex((m) => m.state === 'working');
    run.working({
      what: state.cancelled ? 'Finishing the ones under way' : what,
      count: `${finished.toLocaleString()} of ${total.toLocaleString()}`,
      fraction: total ? finished / total : 0,
      file: working === -1 ? '' : files[working].name,
      left: state.cancelled ? '' : left,
    });
    run.queue(queueRows(files, marks, firstUnfinished(), poolSize() + 2, FAILED_WHILE_RUNNING));
  };
  state.repaint = paint;

  paint();
  // Convert sits at the bottom of the settings; bring the run part into view
  // so it is plain that the run started.
  $('run').scrollIntoView({ block: 'nearest', behavior: 'smooth' });

  function tick() {
    finished++;
    const elapsed = (performance.now() - started) / 1000;
    const rate = finished / elapsed;
    if (finished > 3 && rate > 0) left = `About ${formatDuration((total - finished) / rate)} left`;
    paint();
  }

  // A failure carries where it happened: reading and decoding, or saving.
  const failure = (message, stage) => Object.assign(new Error(message), { stage });

  async function runOne(worker, file) {
    const plan = await window.ponder.plan({ sourcePath: file.path });

    if (plan.action === 'skip') {
      if (plan.unreadable) throw failure("Couldn't be read. It is damaged, or not a photo.", 'read');
      // A bare count left people guessing which file was skipped and why. The
      // words are the engine's, the command line's too.
      results.skipReasons.add(plan.reason);
      return { skipped: true, note: `Skipped: ${skipText(plan, 'app')}` };
    }

    // Already in the output format, going into a results folder: copied in as
    // it is, so the folder is complete.
    if (plan.copy) {
      try {
        await window.ponder.copy({ targetPath: plan.path, sourcePath: file.path, keepDate: settings.keepDate, folder: plan.folder });
      } catch (err) {
        throw failure(plainError(err), 'save');
      }
      results.copied++;
      results.folders.add(plan.folder);
      if (!results.firstOutput) results.firstOutput = plan.path;
      return { skipped: false, copied: true };
    }

    let out;
    try {
      const bytes = await window.ponder.read(file.path);
      out = await worker.run(
        {
          bytes,
          name: file.name,
          format: settings.format,
          quality: settings.quality,
          maxDim: settings.maxDim,
          keepMetadata: settings.keepMetadata,
          maxQuality: settings.maxQuality,
        },
        [bytes],
      );
    } catch (err) {
      throw failure(plainError(err), 'read');
    }

    try {
      await window.ponder.write({
        targetPath: plan.path,
        bytes: out.bytes,
        sourcePath: file.path,
        keepDate: settings.keepDate,
        folder: plan.folder,
      });
    } catch (err) {
      throw failure(plainError(err), 'save');
    }

    results.converted++;
    if (plan.folder) results.folders.add(plan.folder); else results.besideCount++;
    results.bytesOut += out.bytes.byteLength;
    if (!results.firstOutput) results.firstOutput = plan.path;
    return { skipped: false };
  }

  // Each worker pulls the next file as soon as it frees up, so one slow photo
  // never stalls the others.
  async function pump(worker) {
    while (!state.cancelled) {
      const index = next++;
      if (index >= total) break;
      const file = files[index];
      marks[index] = { state: 'working' };
      paint();
      try {
        const r = await runOne(worker, file);
        if (r.skipped) {
          results.skipped++;
          marks[index] = { state: 'skipped', note: r.note };
        } else {
          marks[index] = r.copied ? { state: 'done', note: `Already ${formatName(settings.format)}, copied as it is` } : { state: 'done' };
        }
      } catch (err) {
        results.failed++;
        if (err.stage === 'save') results.unsaved++; else results.unreadable++;
        marks[index] = { state: 'failed', note: err.message || 'Could not be converted' };
      }
      tick();
    }
  }

  const workers = [];
  try {
    await window.ponder.startRun(files.map((f) => f.path), {
      format: settings.format, onExisting: settings.onExisting, outDir: settings.outDir, beside: settings.beside,
    });
    for (let i = 0; i < poolSize(); i++) workers.push(createWorker());
    await Promise.all(workers.map(pump));
  } finally {
    for (const w of workers) w.terminate();
    state.running = false;
    state.repaint = null;
    $('btn-convert').disabled = false;
    start.buttons.change.disabled = false;
    if (start.buttons.changeAlso) start.buttons.changeAlso.disabled = false;
    setSettingsLocked(false);
  }

  const elapsed = (performance.now() - started) / 1000;
  if (finished > 0 && !settings.maxQuality) {
    window.__ponderPerFileMs = (elapsed * 1000 * poolSize()) / finished;
  }

  // Cancel pressed while the last files were already under way stops nothing:
  // everything was done, so it is a finished run, not a stopped one.
  results.stopped = state.cancelled && finished < total;
  state.results = results;
  run.queue(queueRows(files, marks, firstUnfinished(), 0, FAILED_AT_END));
  showDone(results, elapsed, settings);
  updatePlanNote();
}

function savedWhere(settings, results) {
  if (settings.outDir) return `Saved to ${settings.outDir}`;
  const folders = [...results.folders];
  const saved = results.converted + results.copied;
  const files = (n) => `${n.toLocaleString()} ${n === 1 ? 'file' : 'files'}`;
  if (folders.length === 1 && !results.besideCount) return `Saved ${files(saved)} in ${baseName(folders[0])}`;
  if (folders.length > 1 && !results.besideCount) return `Saved ${files(saved)} in ${folders.length} new folders beside the originals`;
  if (folders.length) {
    const n = results.besideCount;
    return `Saved ${files(saved - n)} in ${folders.length === 1 ? baseName(folders[0]) : `${folders.length} new folders`}, ${n.toLocaleString()} next to ${n === 1 ? 'its original' : 'their originals'}`;
  }
  return state.folderName ? `Saved next to the originals in ${state.folderName}` : 'Saved next to the originals';
}

function showDone(results, elapsed, settings) {
  // Nothing saved at all, and every file failed at saving (none unreadable,
  // none skipped): that is the folder, not the photos, so it is one failure for
  // the whole run. The queue above it still lists each file and its reason.
  // Mixed with damaged photos or skips, the done line counts each kind instead.
  if (!results.stopped && !results.converted && !results.copied && results.unsaved > 0 && !results.unreadable && !results.skipped) {
    const into = settings.outDir ? baseName(settings.outDir) : state.folderName;
    run.failed(`Just JPEG cannot save ${into ? `to ${into}` : 'next to these photos'}. Choose another folder to save to.`);
    return;
  }

  // "Done" over nothing converted read as success.
  const saved = results.converted + results.copied;
  const lead = results.stopped ? 'Stopped.' : saved ? 'Done.' : 'Nothing converted.';
  const bits = [];
  if (results.converted || results.stopped || !results.copied) bits.push(`${plural(results.converted, 'photo')} converted`);
  if (results.copied) bits.push(`${results.copied.toLocaleString()} already ${formatName(settings.format)}, copied as they are`);
  if (results.unreadable) bits.push(`${results.unreadable.toLocaleString()} could not be read`);
  if (results.unsaved) bits.push(`${results.unsaved.toLocaleString()} could not be saved`);
  if (results.skipped) bits.push(`${results.skipped.toLocaleString()} skipped`);

  let where = saved ? savedWhere(settings, results) : '';
  if (results.skipReasons.has('exists') || results.skipReasons.has('original')) {
    where += `${where ? '. ' : ''}To convert the skipped ones too, choose "Keep both" under "If a file already exists", or another folder to save to.`;
  }

  const oneFolder = results.folders.size === 1 && !results.besideCount && !settings.outDir;
  run.done({
    title: `${lead} ${bits.join(', ')}`.trim(),
    detail: results.converted
      ? `${formatBytes(results.bytesOut)} of ${formatName(settings.format)} in ${formatDuration(elapsed)}`
      : '',
    where,
    // Nothing written, nothing to show; stopped or nothing converted did not
    // get all the way.
    reveal: !!results.firstOutput,
    // When they all went into one new folder, the button shows the folder.
    revealLabel: oneFolder ? 'Show me the folder' : 'Show me the file',
    tone: results.stopped || !saved ? 'over' : '',
  });
  $('run').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// What the kit's run part shows: idle, working, done or failed.
const runState = () => $('run').dataset.state;

function startConvert() {
  if (state.running || !state.files.length) return;
  convertAll().catch((err) => {
    // Anything that stops the whole run (the workers would not start, the
    // run could not be set up) lands here, with Try again. The queue painted
    // for the run goes: its half-run rows would sit under the failure.
    run.queue([]);
    run.failed(`The photos could not be converted: ${plainError(err)}`);
    updatePlanNote();
  });
}

// ----------------------------------------------------------------- wiring ---

const SAY_DROP = 'Drop photos or a folder to convert';
const HOW_IT_WORKS = 'https://ponderdev.com/tools/just-jpeg/how-it-works';

function resetToStart() {
  if (state.running) return;
  state.files = [];
  state.folderName = null;
  state.outputDir = null;
  state.results = null;
  setOutputLabel('Next to each original');
  updateOutputButtons();
  $('where-field').hidden = true;
  // A new batch starts from the usual settings, not the last one's, so nothing
  // is carried over that the person cannot see. (Save next to the originals
  // instead is the one choice kept, as it always was: it is stored.)
  format.set('jpeg');
  $('quality').value = '85';
  $('quality-value').textContent = '85';
  $('size').value = '0';
  $('existing').value = 'skip';
  $('keep-metadata').checked = true;
  $('keep-date').checked = true;
  $('max-quality').checked = false;
  updateFormatHint();
  run.reset();
  start.reset();
  $('plan-note').textContent = '';
}

function wire() {
  start = Kit.start($('start'), {
    name: 'Just JPEG',
    version: window.ponder.version,
    line: 'Turns photos from any camera into JPEG.',
    icon: 'photos',
    say: 'Drop your photos or a folder here',
    choose: CHOOSE_LABEL,
    also: window.ponder.folderButton ? { label: 'Choose a folder', onClick: pickFolderAndAdd, change: 'Change folder' } : null,
    changeLabel: 'Change photos',
    takes: 'HEIC, HEIF, DNG and camera RAW, plus JPEG, PNG, TIFF and WebP',
    onChoose: pickAndAdd,
    // Use it with your assistant: the tool's own SKILL.md, and what a skill is.
    skill: {
      copy: () => window.ponder.skill(),
      about: () => window.ponder.openExternal(HOW_IT_WORKS),
    },
    // A drop on the zone is caught by the veil below, which takes drops on
    // the whole window, so it is not handled twice.
  });
  start.buttons.choose.id = 'btn-choose';
  start.buttons.change.id = 'btn-change';
  if (start.buttons.also) start.buttons.also.id = 'btn-choose-folder';
  if (start.buttons.changeAlso) start.buttons.changeAlso.id = 'btn-change-folder';

  // Without this the window just navigates to the dropped file.
  // Not while a run goes: there is no veil and no drop then (the cursor shows
  // it is refused), and the drop listener below says why.
  veil = Kit.veil({
    say: SAY_DROP,
    icon: 'photos',
    when: () => !state.running,
    onDrop: (files) => addPaths(files.map((f) => window.ponder.pathForFile(f)).filter(Boolean)),
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    if (state.running && e.dataTransfer && [...e.dataTransfer.types].includes('Files')) {
      $('plan-note').textContent = 'Wait for this run to finish first.';
    }
  });

  Kit.footer($('footer'), {
    onSite: () => window.ponder.openExternal('https://ponderdev.com'),
    onLicences: () => window.ponder.licenses(),
  });

  run = Kit.run($('run'), {
    onCancel: () => {
      if (!state.running) return;
      state.cancelled = true;
      if (state.repaint) state.repaint();
    },
    onReveal: () => {
      const r = state.results;
      if (!r) return;
      // One new results folder: show it. Otherwise the first file saved.
      if (r.folders.size === 1 && !r.besideCount && r.firstOutput) window.ponder.reveal([...r.folders][0]);
      else if (r.firstOutput) window.ponder.reveal(r.firstOutput);
    },
    onAgain: resetToStart,
    onRetry: startConvert,
  });

  format = Kit.segmented($('seg-format'), [['jpeg', 'JPEG'], ['png', 'PNG']], {
    value: 'jpeg',
    onChange: updateFormatHint,
  });

  $('quality').addEventListener('input', (e) => {
    $('quality-value').textContent = e.target.value;
  });

  $('max-quality').addEventListener('change', updatePlanNote);

  $('btn-output').addEventListener('click', async () => {
    const dir = await window.ponder.pickOutput();
    if (dir) {
      state.outputDir = dir;
      updateWhere();
    }
  });

  // Back to the default: next to each original, or a folder's new folder beside it.
  $('btn-output-clear').addEventListener('click', () => {
    state.outputDir = null;
    updateWhere();
  });

  $('beside').addEventListener('change', () => {
    settings.set('beside', $('beside').checked);
    updateWhere();
  });

  $('btn-convert').addEventListener('click', startConvert);
}

(async function boot() {
  wire();
  const info = await window.ponder.info();
  state.cores = info.cores;
  document.title = `Just JPEG ${Kit.versionLabel(info.version)}`;
})();
