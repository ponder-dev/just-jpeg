// Camera RAW to pixels, for the app's conversion worker and the command line
// alike. One copy, so the two cannot disagree about a picture: the same
// LibRaw, the same settings, the same 16-bit to 8-bit step, the same details
// kept for the EXIF block.
//
// What differs is only how LibRaw gets loaded (the worker imports the copy
// beside the page, node imports the package and installs the shim in
// rawshim.js first), so the caller hands that in as `loadLibRaw`.
//
// LibRaw has already turned the picture upright by the camera's own flip
// (the metadata still reports it). Nothing here or after it turns it again.

/** How long one decode may take before it is given up as hung. */
export const RAW_TIMEOUT_MS = 180000;

export class RawTimeout extends Error {}

/**
 * Decode one RAW file.
 *   bytes        the file (left untouched; LibRaw gets a copy)
 *   loadLibRaw   async () => the LibRaw class
 *   timeoutMs    give up after this long, plainly (default RAW_TIMEOUT_MS)
 * Returns { width, height, data (RGBA, Uint8ClampedArray), meta }, where meta
 * is what buildExif (exif.js) wants, or null.
 */
export async function decodeRaw(bytes, { loadLibRaw, timeoutMs = RAW_TIMEOUT_MS } = {}) {
  const LibRaw = await loadLibRaw();
  const lr = new LibRaw();
  let timer;
  const timedOut = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new RawTimeout(`The RAW decoder did not answer in ${Math.round(timeoutMs / 1000)} seconds, so it was stopped. The file may be damaged`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([timedOut, run(lr, bytes)]);
  } finally {
    clearTimeout(timer);
    try { lr.dispose(); } catch { /* already gone */ }
  }
}

async function run(lr, bytes) {
  // open() hands the buffer to libraw's own worker, which detaches it. Pass
  // a copy, or the caller is left holding an empty ArrayBuffer.
  await lr.open(bytes.slice());
  const img = await lr.imageData();
  if (!img || !img.width || !img.height) throw new Error('RAW decoder returned no image');

  const { width, height } = img;
  const src = img.data;
  const channels = src.length / (width * height);
  const rgba = new Uint8ClampedArray(width * height * 4);

  // libraw hands back 3- or 4-channel data, 8 or 16 bits deep.
  const sixteenBit = src.BYTES_PER_ELEMENT === 2;
  const shift = sixteenBit ? 8 : 0;
  for (let i = 0, p = 0, q = 0; i < width * height; i++) {
    rgba[q++] = shift ? src[p] >> shift : src[p]; p++;
    rgba[q++] = shift ? src[p] >> shift : src[p]; p++;
    rgba[q++] = shift ? src[p] >> shift : src[p]; p++;
    rgba[q++] = channels >= 4 ? (shift ? src[p++] >> shift : src[p++]) : 255;
  }

  // A RAW file's own TIFF structure is far too large to embed in a JPEG, so
  // collect the values we care about and write a small EXIF block later.
  let meta = null;
  try {
    const m = await lr.metadata(true);
    if (m) {
      meta = {
        make: m.camera_make,
        model: m.camera_model,
        date: m.timestamp,
        iso: m.iso_speed,
        exposureTime: m.shutter,
        fNumber: m.aperture,
        focalLength: m.focal_len,
        artist: m.artist,
        lens: m.lens && m.lens.Lens,
      };
    }
  } catch { /* metadata is a bonus, not a reason to fail the conversion */ }

  return { width, height, data: rgba, meta };
}

/** A gate that lets at most `limit` jobs run at once (a RAW file in memory is large). */
export function createGate(limit = 1) {
  let active = 0;
  const waiting = [];
  return async function gated(job) {
    if (active >= limit) await new Promise((resolve) => waiting.push(resolve));   // the slot is handed over, not freed
    else active++;
    try {
      return await job();
    } finally {
      const next = waiting.shift();
      if (next) next(); else active--;
    }
  };
}
