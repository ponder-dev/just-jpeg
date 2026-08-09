// UI controller. Owns the worker pool and walks the queue; every filesystem
// touch goes through window.ponder.

const $ = (id) => document.getElementById(id);

const views = {
  drop: $('view-drop'),
  settings: $('view-settings'),
  progress: $('view-progress'),
  done: $('view-done'),
};

const state = {
  files: [],
  outputDir: null,
  cores: 4,
  cancelled: false,
  results: null,
};

function show(name) {
  for (const [key, el] of Object.entries(views)) el.classList.toggle('hidden', key !== name);
}

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

function plural(n, word) {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;
}

// ------------------------------------------------------------ picking files ---

async function addPaths(paths) {
  if (!paths || !paths.length) return;
  $('btn-choose').disabled = true;
  $('btn-choose').textContent = 'Looking for photos...';
  try {
    const found = await window.ponder.scan(paths);
    if (!found.length) {
      alert('No photos found in there.\n\nJust JPEG looks for HEIC, RAW, JPEG, PNG, TIFF and WEBP files.');
      return;
    }
    state.files = found;
    showSettings();
  } finally {
    $('btn-choose').disabled = false;
    $('btn-choose').textContent = 'Choose photos or folders';
  }
}

function showSettings() {
  const total = state.files.reduce((sum, f) => sum + f.size, 0);
  $('file-summary').textContent = plural(state.files.length, 'photo');
  $('file-detail').textContent = `${formatBytes(total)} in total`;
  updatePlanNote();
  show('settings');
}

function updatePlanNote() {
  // A HEIC takes roughly this long per worker; replaced by a real
  // measurement after the first run.
  const perFile = window.__ponderPerFileMs || 1800;
  const slower = $('max-quality') && $('max-quality').checked ? 2.4 : 1;
  const seconds = (state.files.length * perFile * slower) / Math.max(1, poolSize()) / 1000;
  $('plan-note').textContent = state.files.length
    ? `Roughly ${formatDuration(seconds)}`
    : '';
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

function readSettings() {
  const format = document.querySelector('#seg-format .on').dataset.value;
  return {
    format,
    quality: Number($('quality').value),
    maxDim: Number($('size').value) || 0,
    keepMetadata: $('keep-metadata').checked,
    keepDate: $('keep-date').checked,
    maxQuality: $('max-quality').checked,
    onExisting: $('existing').value,
  };
}

async function convertAll() {
  const settings = readSettings();
  const total = state.files.length;
  const workers = Array.from({ length: poolSize() }, createWorker);

  state.cancelled = false;
  const results = { converted: 0, skipped: 0, failed: 0, errors: [], bytesOut: 0, firstOutput: null };

  let next = 0;
  let finished = 0;
  const started = performance.now();

  $('progress-title').textContent = `Converting to ${settings.format === 'png' ? 'PNG' : 'JPEG'}`;
  $('progress-fill').style.width = '0%';
  $('progress-count').textContent = `0 of ${total.toLocaleString()}`;
  $('progress-file').textContent = '';
  $('progress-eta').textContent = '';
  show('progress');

  function tick(name) {
    finished++;
    const pct = (finished / total) * 100;
    $('progress-fill').style.width = `${pct}%`;
    $('progress-count').textContent = `${finished.toLocaleString()} of ${total.toLocaleString()}`;
    if (name) $('progress-file').textContent = name;

    const elapsed = (performance.now() - started) / 1000;
    const rate = finished / elapsed;
    if (finished > 3 && rate > 0) {
      $('progress-eta').textContent = `About ${formatDuration((total - finished) / rate)} left`;
    }
  }

  async function runOne(worker, file) {
    const plan = await window.ponder.plan({
      sourcePath: file.path,
      outDir: state.outputDir,
      format: settings.format,
      onExisting: settings.onExisting,
    });

    if (plan.action === 'skip') {
      results.skipped++;
      return;
    }

    const bytes = await window.ponder.read(file.path);
    const out = await worker.run(
      {
        bytes,
        format: settings.format,
        quality: settings.quality,
        maxDim: settings.maxDim,
        keepMetadata: settings.keepMetadata,
        maxQuality: settings.maxQuality,
      },
      [bytes],
    );

    await window.ponder.write({
      targetPath: plan.path,
      bytes: out.bytes,
      sourcePath: file.path,
      keepDate: settings.keepDate,
    });

    results.converted++;
    results.bytesOut += out.bytes.byteLength;
    if (!results.firstOutput) results.firstOutput = plan.path;
  }

  // Each worker pulls the next file as soon as it frees up, so one slow photo
  // never stalls the others.
  async function pump(worker) {
    while (!state.cancelled) {
      const index = next++;
      if (index >= total) break;
      const file = state.files[index];
      try {
        await runOne(worker, file);
      } catch (err) {
        results.failed++;
        if (results.errors.length < 200) {
          results.errors.push({ name: file.name, message: (err && err.message) || String(err) });
        }
      }
      tick(file.name);
    }
  }

  await Promise.all(workers.map(pump));
  for (const w of workers) w.terminate();

  const elapsed = (performance.now() - started) / 1000;
  if (finished > 0 && !settings.maxQuality) {
    window.__ponderPerFileMs = (elapsed * 1000 * poolSize()) / finished;
  }

  state.results = results;
  showDone(results, elapsed, settings);
}

function showDone(results, elapsed, settings) {
  $('done-title').textContent = state.cancelled ? 'Stopped' : 'All done';

  const bits = [`${plural(results.converted, 'photo')} converted`];
  if (results.skipped) bits.push(`${results.skipped.toLocaleString()} skipped`);
  if (results.failed) bits.push(`${results.failed.toLocaleString()} failed`);
  $('done-summary').textContent = bits.join(', ');

  const where = state.outputDir || 'next to the originals';
  $('done-saved').textContent = results.converted
    ? `${formatBytes(results.bytesOut)} of ${settings.format === 'png' ? 'PNG' : 'JPEG'} saved ${state.outputDir ? 'to ' : ''}${where}, in ${formatDuration(elapsed)}.`
    : '';

  const errorBox = $('done-errors');
  errorBox.classList.toggle('hidden', results.errors.length === 0);
  if (results.errors.length) {
    $('error-list').innerHTML = '';
    for (const e of results.errors.slice(0, 100)) {
      const li = document.createElement('li');
      const b = document.createElement('b');
      b.textContent = e.name;
      li.append(b, document.createTextNode(`: ${e.message}`));
      $('error-list').appendChild(li);
    }
  }

  $('btn-reveal').classList.toggle('hidden', !results.firstOutput);
  show('done');
}

// ----------------------------------------------------------------- wiring ---

function resetToStart() {
  state.files = [];
  state.outputDir = null;
  state.results = null;
  $('output-label').textContent = 'Next to each original';
  show('drop');
}

function wire() {
  const dz = $('dropzone');

  // Without these the window just navigates to the dropped file.
  for (const type of ['dragenter', 'dragover']) {
    dz.addEventListener(type, (e) => { e.preventDefault(); dz.classList.add('over'); });
  }
  for (const type of ['dragleave', 'dragend']) {
    dz.addEventListener(type, () => dz.classList.remove('over'));
  }
  dz.addEventListener('drop', async (e) => {
    e.preventDefault();
    dz.classList.remove('over');
    const paths = [...e.dataTransfer.files]
      .map((f) => window.ponder.pathForFile(f))
      .filter(Boolean);
    await addPaths(paths);
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  $('btn-choose').addEventListener('click', async () => {
    await addPaths(await window.ponder.pickInput());
  });

  $('link-licenses').addEventListener('click', (e) => {
    e.preventDefault();
    window.ponder.licenses();
  });

  $('link-ponderdev').addEventListener('click', (e) => {
    e.preventDefault();
    window.ponder.openExternal('https://ponderdev.com');
  });

  $('btn-clear').addEventListener('click', resetToStart);
  $('btn-again').addEventListener('click', resetToStart);

  $('seg-format').addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button) return;
    for (const b of $('seg-format').children) b.classList.toggle('on', b === button);
    const isPng = button.dataset.value === 'png';
    $('field-quality').classList.toggle('hidden', isPng);
    $('hint-format').textContent = isPng
      ? 'Lossless and larger. Photo details are not carried over.'
      : 'Best for photos. Keeps date, camera and location.';
  });

  $('quality').addEventListener('input', (e) => {
    $('quality-value').textContent = e.target.value;
  });

  $('max-quality').addEventListener('change', updatePlanNote);

  $('btn-output').addEventListener('click', async () => {
    const dir = await window.ponder.pickOutput();
    if (dir) {
      state.outputDir = dir;
      $('output-label').textContent = dir;
    }
  });

  $('btn-convert').addEventListener('click', () => {
    $('btn-convert').disabled = true;
    convertAll().finally(() => { $('btn-convert').disabled = false; });
  });

  $('btn-cancel').addEventListener('click', () => {
    state.cancelled = true;
    $('progress-title').textContent = 'Finishing the last few...';
  });

  $('btn-reveal').addEventListener('click', () => {
    if (state.results?.firstOutput) window.ponder.reveal(state.results.firstOutput);
  });
}

(async function start() {
  const info = await window.ponder.info();
  state.cores = info.cores;
  document.title = `Just JPEG ${info.version}`;
  wire();
  show('drop');
})();
