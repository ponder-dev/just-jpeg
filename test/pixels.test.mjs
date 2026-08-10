// The orientation mapping, checked against an independent implementation.
//
//   node test/pixels.test.mjs
//
// orient() maps destination pixels back to source. This reference maps source
// pixels forward to destination, written separately from first principles. If
// both agree on every pixel of an asymmetric image for all eight orientations,
// a transcription error in either would have to be mirrored in the other to
// slip through.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { orient, swapsAxes } from '../src/pixels.js';

// Forward: where does src(x, y) land?
function forward(orientation, x, y, w, h) {
  switch (orientation) {
    case 1: return [x, y];
    case 2: return [w - 1 - x, y];
    case 3: return [w - 1 - x, h - 1 - y];
    case 4: return [x, h - 1 - y];
    case 5: return [y, x];                    // transpose: reflect across the main diagonal
    case 6: return [h - 1 - y, x];            // 90 clockwise
    case 7: return [h - 1 - y, w - 1 - x];    // transverse
    case 8: return [y, w - 1 - x];            // 90 anticlockwise
    default: throw new Error('bad orientation');
  }
}

function makeImage(w, h) {
  // Every pixel unique, so any misplacement is caught.
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = i % 256;
    data[i * 4 + 1] = Math.floor(i / 256);
    data[i * 4 + 2] = 7;
    data[i * 4 + 3] = 255;
  }
  return { data, width: w, height: h };
}

for (let o = 1; o <= 8; o++) {
  test(`orientation ${o} agrees with the reference`, () => {
    const w = 5, h = 3;                        // asymmetric on purpose
    const src = makeImage(w, h);
    const out = orient(src, o);

    const [ow, oh] = swapsAxes(o) ? [h, w] : [w, h];
    assert.equal(out.width, ow);
    assert.equal(out.height, oh);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [dx, dy] = forward(o, x, y, w, h);
        const s = (y * w + x) * 4;
        const d = (dy * out.width + dx) * 4;
        for (let c = 0; c < 4; c++) {
          assert.equal(out.data[d + c], src.data[s + c],
            `orientation ${o}: src(${x},${y}) should land at dst(${dx},${dy})`);
        }
      }
    }
  });
}

test('orientation 1 returns the input untouched', () => {
  const img = makeImage(4, 4);
  assert.equal(orient(img, 1).data, img.data);
});

test('a quarter turn twice is a half turn', () => {
  const img = makeImage(5, 3);
  const twice = orient(orient(img, 6), 6);
  const half = orient(img, 3);
  assert.deepEqual(Array.from(twice.data), Array.from(half.data));
});
