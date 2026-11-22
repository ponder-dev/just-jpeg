// EXIF orientation, applied to raw RGBA buffers.
//
// The app does this on a canvas in render.js, which the command line does not
// have. Same eight cases, same meaning, different medium. Getting this wrong
// shows up as sideways photos, which is the most visible bug this tool could
// possibly ship, so the mapping is tested against an independently written
// forward transform for every orientation.
//
// Each case maps a destination pixel back to its source. Orientations 5 to 8
// swap the axes, so the output is the other way round.

/** Does this orientation turn the image a quarter turn? */
export function swapsAxes(orientation) {
  return orientation >= 5 && orientation <= 8;
}

/**
 * Return { data, width, height } with `orientation` baked in, so the result
 * is upright (orientation 1). Input is not modified. Orientation 1 returns
 * the input untouched rather than a copy.
 */
export function orient({ data, width, height }, orientation = 1) {
  if (!orientation || orientation === 1) return { data, width, height };

  const outW = swapsAxes(orientation) ? height : width;
  const outH = swapsAxes(orientation) ? width : height;
  const out = new Uint8ClampedArray(outW * outH * 4);

  // dst(x, y) <- src(sx, sy)
  let sx, sy;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      switch (orientation) {
        case 2: sx = width - 1 - x; sy = y; break;               // mirror across
        case 3: sx = width - 1 - x; sy = height - 1 - y; break;  // half turn
        case 4: sx = x; sy = height - 1 - y; break;              // mirror down
        case 5: sx = y; sy = x; break;                           // transpose
        case 6: sx = y; sy = height - 1 - x; break;              // quarter turn clockwise
        case 7: sx = width - 1 - y; sy = height - 1 - x; break;  // transverse
        case 8: sx = width - 1 - y; sy = x; break;               // quarter turn anticlockwise
        default: sx = x; sy = y;
      }
      const s = (sy * width + sx) * 4;
      const d = (y * outW + x) * 4;
      out[d] = data[s];
      out[d + 1] = data[s + 1];
      out[d + 2] = data[s + 2];
      out[d + 3] = data[s + 3];
    }
  }
  return { data: out, width: outW, height: outH };
}

/**
 * JPEG has no alpha, and mozjpeg simply drops it, so a transparent pixel showed
 * whatever colour happened to sit under it. Blend onto white, as the app's
 * canvas does when it fills white first (engine.BACKGROUND). In place.
 */
export function flattenOnWhite(data) {
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i];
    if (a === 255) continue;
    const k = 255 - a;
    data[i - 3] = Math.round((data[i - 3] * a + 255 * k) / 255);
    data[i - 2] = Math.round((data[i - 2] * a + 255 * k) / 255);
    data[i - 1] = Math.round((data[i - 1] * a + 255 * k) / 255);
    data[i] = 255;
  }
}
