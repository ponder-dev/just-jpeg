// Drives the built worker through every fixture and checks the output.

import { extractExif, readOrientation } from '../src/exif.js';
import { render } from '../src/render.js';
import { fitSize } from '../src/engine.js';
import { decodeRaw } from '../src/raw.js';

const log = (m) => console.log(`[test] ${m}`);

// --------------------------------------------------------- orientation maths ---
//
// A 2x2 image with four distinct corners, pushed through all eight EXIF
// orientations. Expected layouts are the standard definitions, written out
// reading-order: [topLeft, topRight, bottomLeft, bottomRight].

const R = [255, 0, 0], G = [0, 255, 0], B = [0, 0, 255], W = [255, 255, 255];
const NAMES = { R: 'red', G: 'green', B: 'blue', W: 'white' };
const label = (px) => (px[0] > 200 && px[1] < 60 && px[2] < 60 ? 'R'
  : px[0] < 60 && px[1] > 200 && px[2] < 60 ? 'G'
    : px[0] < 60 && px[1] < 60 && px[2] > 200 ? 'B'
      : px[0] > 200 && px[1] > 200 && px[2] > 200 ? 'W' : '?');

// Source:  R G
//          B W
const EXPECTED = {
  1: 'RGBW', 2: 'GRWB', 3: 'WBGR', 4: 'BWRG',
  5: 'RBGW', 6: 'BRWG', 7: 'WGBR', 8: 'GWRB',
};

async function testOrientations() {
  const data = new Uint8ClampedArray([...R, 255, ...G, 255, ...B, 255, ...W, 255]);
  const source = await createImageBitmap(new ImageData(data, 2, 2));
  const failures = [];

  for (const orientation of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const canvas = render(source, 2, 2, orientation, 0);
    const px = canvas.getContext('2d').getImageData(0, 0, 2, 2).data;
    const got = [0, 1, 2, 3]
      .map((i) => label([px[i * 4], px[i * 4 + 1], px[i * 4 + 2]]))
      .join('');
    if (got !== EXPECTED[orientation]) {
      failures.push(`orientation ${orientation}: expected ${EXPECTED[orientation]}, got ${got}`);
    }
  }
  // The canvas and the command line's raw buffers must come out the same size:
  // both take it from the engine (tools-72), and this proves the canvas does.
  const big = await createImageBitmap(new ImageData(new Uint8ClampedArray(300 * 200 * 4), 300, 200));
  for (const [orientation, maxDim] of [[1, 0], [6, 0], [1, 100], [8, 90], [3, 1000], [5, 7]]) {
    const want = fitSize(300, 200, orientation, maxDim);
    const canvas = render(big, 300, 200, orientation, maxDim);
    if (canvas.width !== want.width || canvas.height !== want.height) {
      failures.push(`size at orientation ${orientation}, max ${maxDim}: canvas ${canvas.width}x${canvas.height}, engine ${want.width}x${want.height}`);
    }
  }
  return failures;
}

function makeWorker() {
  const worker = new Worker(new URL('../app/renderer/convert.worker.js', import.meta.url), { type: 'module' });
  let id = 0;
  const pending = new Map();
  worker.onmessage = ({ data }) => {
    const entry = pending.get(data.id);
    if (!entry) return;
    pending.delete(data.id);
    data.ok ? entry.resolve(data) : entry.reject(new Error(data.error));
  };
  worker.onerror = (e) => log(`worker error: ${e.message}`);
  return {
    run: (job, transfer) => new Promise((resolve, reject) => {
      const n = ++id;
      pending.set(n, { resolve, reject });
      worker.postMessage({ id: n, job }, transfer);
    }),
  };
}

/** Pull the chroma sampling factors out of a JPEG's SOF0/SOF2 header. */
function readChromaSampling(b) {
  let p = 2;
  while (p + 4 <= b.length) {
    if (b[p] !== 0xff) { p++; continue; }
    const marker = b[p + 1];
    const len = (b[p + 2] << 8) | b[p + 3];
    // SOF0 (baseline) or SOF2 (progressive)
    if (marker === 0xc0 || marker === 0xc2) {
      const components = b[p + 9];
      if (components < 3) return 'gray';
      // Component 2 is Cb: its sampling factors relative to luma.
      const cb = b[p + 10 + 3 + 1];
      return `${cb >> 4}x${cb & 0x0f}`;
    }
    if (marker === 0xda) break;
    p += 2 + len;
  }
  return 'unknown';
}

function isJpeg(b) { return b[0] === 0xff && b[1] === 0xd8 && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9; }
function isPng(b) { return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47; }

(async function run() {
  const cases = await window.t.cases();
  const worker = makeWorker();
  const rows = [];

  const orientationFailures = await testOrientations();
  rows.push({
    file: 'all 8 rotations',
    format: '-',
    ok: orientationFailures.length === 0,
    dims: '2x2',
    notes: orientationFailures.length ? orientationFailures.join('; ') : 'every orientation correct',
  });
  log(`orientation maths: ${orientationFailures.length ? 'FAILED' : 'ok'}`);

  // The window's RAW decode (the shared module on the copy of LibRaw the app
  // ships) against the command line's (the same module, in node under this
  // app's runtime): the same pixels, and the command line converts under it.
  if (cases.some((c) => c.file === 'sample.dng')) {
    const row = { file: 'sample.dng', format: 'cli', ok: false, notes: '' };
    try {
      const bytes = new Uint8Array(await window.t.fixture('sample.dng'));
      const url = new URL('../app/renderer/vendor/libraw/index.js', import.meta.url).href;
      const mine = await decodeRaw(bytes, { loadLibRaw: async () => (await import(url)).default });
      const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', mine.data))].map((b) => b.toString(16).padStart(2, '0')).join('');
      const theirs = await window.t.nodeRaw('sample.dng');
      const problems = [];
      if (!theirs.hash) problems.push(`node-side decode failed: ${theirs.hashError}`);
      else {
        if (theirs.hash.width !== mine.width || theirs.hash.height !== mine.height) problems.push(`size ${theirs.hash.width}x${theirs.hash.height} vs window ${mine.width}x${mine.height}`);
        if (theirs.hash.sha256 !== digest) problems.push('pixels differ between the window and the command line');
      }
      if (theirs.cliStatus !== 0 || theirs.cliBytes < 20000) problems.push(`command line under the app runtime: exit ${theirs.cliStatus}, ${theirs.cliBytes} bytes ${theirs.cliError}`);
      row.ok = problems.length === 0;
      row.dims = `${mine.width}x${mine.height}`;
      row.notes = problems.length ? problems.join('; ') : 'same pixels as the command line; the command line converts under the app runtime';
    } catch (err) {
      row.notes = err.message;
    }
    log(`window and command line pixels: ${row.ok ? 'ok' : 'FAILED: ' + row.notes}`);
    rows.push(row);
  }

  // A damaged camera RAW fails in the window, as on the command line: the
  // first half of sample.dng, once with the name the app passes and once by
  // its bytes alone. It must never come out as its small embedded preview
  // through the TIFF reader (decided 2026-11-21).
  if (cases.some((c) => c.file === 'sample.dng')) {
    const whole = new Uint8Array(await window.t.fixture('sample.dng'));
    for (const name of ['half.dng', '']) {
      const row = { file: `sample.dng cut in half${name ? '' : ', no name'}`, format: 'jpeg', ok: false, notes: '' };
      const bytes = whole.slice(0, Math.floor(whole.length / 2)).buffer;
      try {
        const result = await worker.run({ bytes, name, format: 'jpeg', quality: 85, maxDim: 0, keepMetadata: true, maxQuality: false }, [bytes]);
        row.notes = `converted to ${result.width}x${result.height}, expected a failure`;
      } catch (err) {
        row.ok = /This RAW file is damaged or incomplete/.test(err.message);
        row.notes = row.ok ? 'fails: damaged or incomplete' : `wrong failure: ${err.message}`;
      }
      log(`truncated DNG${name ? '' : ' (no name)'}: ${row.ok ? 'ok' : 'FAILED: ' + row.notes}`);
      rows.push(row);
    }
  }

  for (const [i, c] of cases.entries()) {
    const row = { file: c.file, format: c.format, ok: false, notes: '' };
    try {
      const bytes = await window.t.fixture(c.file);
      const started = performance.now();
      const result = await worker.run({
        bytes,
        format: c.format,
        quality: c.quality,
        maxDim: c.maxDim || 0,
        keepMetadata: c.keepMetadata !== false,
        maxQuality: !!c.maxQuality,
      }, [bytes]);

      const ms = Math.round(performance.now() - started);
      const out = new Uint8Array(result.bytes);
      row.dims = `${result.width}x${result.height}`;
      row.size = `${(out.length / 1024).toFixed(0)}KB`;

      const problems = [];

      // The container must actually be what we asked for.
      if (c.format === 'png' && !isPng(out)) problems.push('not a PNG');
      if (c.format === 'jpeg' && !isJpeg(out)) problems.push('not a valid JPEG');
      if (out.length < 1000) problems.push('suspiciously small');

      if (c.expect.w && result.width !== c.expect.w) problems.push(`width ${result.width} != ${c.expect.w}`);
      if (c.expect.h && result.height !== c.expect.h) problems.push(`height ${result.height} != ${c.expect.h}`);

      // Read the JPEG's SOF marker to find the real chroma sampling. Anything
      // other than 1x1 on the color components means detail was thrown away.
      if (c.expect.fullChroma) {
        const sampling = readChromaSampling(out);
        if (sampling !== '1x1') problems.push(`chroma is ${sampling}, expected 1x1 (4:4:4)`);
      }

      // The claim on the website is that this removes it, so prove it does.
      if (c.expect.noExif) {
        const tiff = extractExif(out);
        if (tiff) problems.push(`EXIF survived (${tiff.length} bytes) when it should have been stripped`);
      }

      if (c.expect.exif) {
        const tiff = extractExif(out);
        if (!tiff) problems.push('EXIF missing from output');
        else if (readOrientation(tiff) !== 1) problems.push('orientation not normalized');
      }

      // withexif.heic is 1200x800 stored with orientation 6, so an upright
      // result must come out portrait.
      if (c.expect.rotated && result.width >= result.height) {
        problems.push(`not rotated upright (${result.width}x${result.height})`);
      }

      row.ok = problems.length === 0;
      row.notes = problems.length ? problems.join('; ') : `${ms}ms`;

      // Keep the source extension in the name: several fixtures share a stem.
      const stem = c.file.replace(/\./g, '_');
      const suffix = c.maxDim ? `-${c.maxDim}` : '';
      await window.t.save({
        name: `${stem}${suffix}-q${c.quality}.${c.format === 'png' ? 'png' : 'jpg'}`,
        bytes: out.buffer,
      });
    } catch (err) {
      row.notes = err.message;
    }
    log(`${i + 1}/${cases.length} ${c.file} -> ${c.format} ${row.ok ? 'ok' : 'FAILED: ' + row.notes}`);
    rows.push(row);
  }

  await window.t.report(rows);
})();
