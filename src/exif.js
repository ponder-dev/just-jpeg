// EXIF extraction and re-embedding.
//
// The goal is to carry the original metadata (date taken, camera, lens, GPS)
// across to the converted file, because losing photo dates is the single most
// annoying thing a converter can do to someone's library.
//
// We copy the raw TIFF/EXIF block byte-for-byte rather than re-encoding it
// from parsed values, so nothing is lost in translation. The one field we
// rewrite is Orientation: the decoders hand us pixels that we then rotate
// upright ourselves, so the output must say "already upright" (1). Leaving
// the original value there would make viewers rotate the image a second time.

const TIFF_LE = 0x4949; // "II"
const TIFF_BE = 0x4d4d; // "MM"
const ORIENTATION_TAG = 0x0112;

// ---------------------------------------------------------------- helpers ---

function u16(b, o, le) { return le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]; }
function u32(b, o, le) {
  return (le
    ? b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)
    : (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

/** Find the TIFF header inside an EXIF payload and return its offset, or -1. */
function findTiffHeader(b, from = 0, limit = 64) {
  const end = Math.min(b.length - 4, from + limit);
  for (let i = from; i <= end; i++) {
    const magic = (b[i] << 8) | b[i + 1];
    if (magic === TIFF_LE && b[i + 2] === 0x2a && b[i + 3] === 0x00) return i;
    if (magic === TIFF_BE && b[i + 2] === 0x00 && b[i + 3] === 0x2a) return i;
  }
  return -1;
}

// ------------------------------------------------------------- orientation ---

/**
 * Read the Orientation tag out of a raw TIFF block.
 * Returns 1..8, defaulting to 1 when absent or unreadable.
 */
export function readOrientation(tiff) {
  try {
    if (!tiff || tiff.length < 8) return 1;
    const le = u16(tiff, 0, false) === TIFF_LE;
    const ifd0 = u32(tiff, 4, le);
    if (ifd0 + 2 > tiff.length) return 1;
    const count = u16(tiff, ifd0, le);
    for (let i = 0; i < count; i++) {
      const entry = ifd0 + 2 + i * 12;
      if (entry + 12 > tiff.length) break;
      if (u16(tiff, entry, le) === ORIENTATION_TAG) {
        const v = u16(tiff, entry + 8, le);
        return v >= 1 && v <= 8 ? v : 1;
      }
    }
  } catch { /* fall through to the safe default */ }
  return 1;
}

/** Rewrite Orientation to `value` in place. No-op if the tag is absent. */
export function setOrientation(tiff, value = 1) {
  try {
    if (!tiff || tiff.length < 8) return tiff;
    const le = u16(tiff, 0, false) === TIFF_LE;
    const ifd0 = u32(tiff, 4, le);
    if (ifd0 + 2 > tiff.length) return tiff;
    const count = u16(tiff, ifd0, le);
    for (let i = 0; i < count; i++) {
      const entry = ifd0 + 2 + i * 12;
      if (entry + 12 > tiff.length) break;
      if (u16(tiff, entry, le) === ORIENTATION_TAG) {
        if (le) { tiff[entry + 8] = value & 0xff; tiff[entry + 9] = 0; }
        else { tiff[entry + 8] = 0; tiff[entry + 9] = value & 0xff; }
        break;
      }
    }
  } catch { /* leave the block untouched */ }
  return tiff;
}

const EXIF_IFD_TAG = 0x8769;
const SIZE_TAGS_IFD0 = [0x0100, 0x0101];     // ImageWidth, ImageLength
const SIZE_TAGS_EXIF = [0xa002, 0xa003];     // PixelXDimension, PixelYDimension

/**
 * Make the size tags in an EXIF block say the size of the picture it now
 * sits in. The block comes from the original, so after a shrink or a quarter
 * turn it still named the old size. Edits in place; a tag that is absent, or
 * not a single number, is left alone.
 */
export function setPixelSize(tiff, width, height) {
  try {
    if (!tiff || tiff.length < 8) return tiff;
    const le = u16(tiff, 0, false) === TIFF_LE;
    const put = (ifd, tags) => {
      if (ifd + 2 > tiff.length) return;
      const count = u16(tiff, ifd, le);
      for (let i = 0; i < count; i++) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > tiff.length) break;
        const tag = u16(tiff, entry, le);
        const at = tags.indexOf(tag);
        if (at === -1 || u32(tiff, entry + 4, le) !== 1) continue;
        const value = at === 0 ? width : height;
        // SHORT holds up to 65535; anything bigger is rewritten as a LONG.
        const type = value > 0xffff ? 4 : u16(tiff, entry + 2, le);
        if (type !== 3 && type !== 4) continue;
        const w16 = (o, v) => { tiff[o] = le ? v & 0xff : v >> 8; tiff[o + 1] = le ? v >> 8 : v & 0xff; };
        w16(entry + 2, type);
        if (type === 3) { w16(entry + 8, value); w16(entry + 10, 0); }
        else if (le) { w16(entry + 8, value & 0xffff); w16(entry + 10, value >>> 16); }
        else { w16(entry + 8, value >>> 16); w16(entry + 10, value & 0xffff); }
      }
    };
    const ifd0 = u32(tiff, 4, le);
    put(ifd0, SIZE_TAGS_IFD0);
    // The Exif sub-IFD hangs off IFD0.
    if (ifd0 + 2 <= tiff.length) {
      const count = u16(tiff, ifd0, le);
      for (let i = 0; i < count; i++) {
        const entry = ifd0 + 2 + i * 12;
        if (entry + 12 > tiff.length) break;
        if (u16(tiff, entry, le) === EXIF_IFD_TAG) put(u32(tiff, entry + 8, le), SIZE_TAGS_EXIF);
      }
    }
  } catch { /* leave the block as it is */ }
  return tiff;
}

// ------------------------------------------------------------ plain TIFFs ---

/**
 * What a plain TIFF says about itself that a viewer would act on: how it is
 * turned (1 to 8) and its colour profile, as UTIF decoded the first page.
 * The pixels are not turned for us, unlike a HEIC or a browser-read JPEG.
 */
export function tiffPageInfo(page) {
  const first = (v) => (Array.isArray(v) || ArrayBuffer.isView(v) ? v[0] : v);
  const o = Number(first(page && page.t274));
  const orientation = o >= 1 && o <= 8 ? o : 1;
  const raw = page && page.t34675;
  const icc = raw && raw.length > 128 ? Uint8Array.from(raw) : null;
  return { orientation, icc };
}

// ------------------------------------------------------- extract from JPEG ---

/** Pull the raw TIFF block out of a JPEG's APP1 segment. */
export function exifFromJpeg(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let p = 2;
  while (p + 4 <= bytes.length) {
    if (bytes[p] !== 0xff) { p++; continue; }
    const marker = bytes[p + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { p += 2; continue; }
    if (marker === 0xda || marker === 0xd9) break; // start of scan / end of image
    const len = (bytes[p + 2] << 8) | bytes[p + 3];
    if (len < 2) break;
    if (marker === 0xe1) {
      const seg = bytes.subarray(p + 4, p + 2 + len);
      const t = findTiffHeader(seg, 0, 16);
      if (t >= 0) return seg.subarray(t).slice();
    }
    p += 2 + len;
  }
  return null;
}

// ------------------------------------------------------- extract from HEIC ---
//
// HEIC is ISO base media file format. The EXIF lives in its own item: `iinf`
// declares an item whose type is "Exif", and `iloc` says where in the file its
// bytes are. exifr could not read these reliably, so we walk the boxes.

function* boxes(b, start, end) {
  let p = start;
  while (p + 8 <= end) {
    let size = u32(b, p, false);
    const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    let header = 8;
    if (size === 1) { // 64-bit size; we only support the low half
      if (p + 16 > end) return;
      size = u32(b, p + 12, false);
      header = 16;
    } else if (size === 0) {
      size = end - p;
    }
    if (size < header || p + size > end) return;
    yield { type, body: p + header, bodyEnd: p + size };
    p += size;
  }
}

function findBox(b, start, end, path) {
  let [head, ...rest] = path;
  for (const box of boxes(b, start, end)) {
    if (box.type !== head) continue;
    // `meta` is a FullBox: skip its version+flags before descending.
    const body = head === 'meta' ? box.body + 4 : box.body;
    return rest.length ? findBox(b, body, box.bodyEnd, rest) : { ...box, body };
  }
  return null;
}

/** Map every declared item to its type, e.g. 1 -> "hvc1", 2 -> "Exif". */
function itemTypes(b, iinf) {
  const types = new Map();
  const version = b[iinf.body];
  let p = iinf.body + 4;
  let count;
  if (version === 0) { count = u16(b, p, false); p += 2; }
  else { count = u32(b, p, false); p += 4; }

  let seen = 0;
  for (const box of boxes(b, p, iinf.bodyEnd)) {
    if (box.type !== 'infe' || seen >= count) continue;
    seen++;
    const v = b[box.body];
    let q = box.body + 4;
    let id;
    if (v < 2) continue;             // ancient layout, has no item_type
    if (v === 2) { id = u16(b, q, false); q += 2; }
    else { id = u32(b, q, false); q += 4; }
    q += 2;                          // item_protection_index
    types.set(id, String.fromCharCode(b[q], b[q + 1], b[q + 2], b[q + 3]));
  }
  return types;
}

/** Resolve an item id to its byte range via the `iloc` box. */
function itemLocation(b, iloc, wantedId) {
  const version = b[iloc.body];
  let p = iloc.body + 4;
  const offsetSize = b[p] >> 4, lengthSize = b[p] & 0x0f;
  const baseOffsetSize = b[p + 1] >> 4, indexSize = b[p + 1] & 0x0f;
  p += 2;

  let count;
  if (version < 2) { count = u16(b, p, false); p += 2; }
  else { count = u32(b, p, false); p += 4; }

  const readSized = (at, size) =>
    size === 4 ? u32(b, at, false)
      : size === 8 ? u32(b, at + 4, false)   // low 32 bits is plenty here
        : size === 2 ? u16(b, at, false) : 0;

  for (let i = 0; i < count; i++) {
    let id;
    if (version < 2) { id = u16(b, p, false); p += 2; }
    else { id = u32(b, p, false); p += 4; }
    if (version === 1 || version === 2) p += 2;   // construction_method
    p += 2;                                        // data_reference_index
    const baseOffset = readSized(p, baseOffsetSize); p += baseOffsetSize;
    const extents = u16(b, p, false); p += 2;

    for (let e = 0; e < extents; e++) {
      if ((version === 1 || version === 2) && indexSize) p += indexSize;
      const off = readSized(p, offsetSize); p += offsetSize;
      const len = readSized(p, lengthSize); p += lengthSize;
      if (id === wantedId) return { offset: baseOffset + off, length: len };
    }
  }
  return null;
}

/** Pull the raw TIFF block out of a HEIC/HEIF/AVIF file. */
export function exifFromHeif(bytes) {
  try {
    const end = bytes.length;
    const iinf = findBox(bytes, 0, end, ['meta', 'iinf']);
    const iloc = findBox(bytes, 0, end, ['meta', 'iloc']);
    if (!iinf || !iloc) return null;

    const types = itemTypes(bytes, iinf);
    let exifId = null;
    for (const [id, type] of types) if (type === 'Exif') { exifId = id; break; }
    if (exifId == null) return null;

    const loc = itemLocation(bytes, iloc, exifId);
    if (!loc || loc.offset + loc.length > end) return null;

    const payload = bytes.subarray(loc.offset, loc.offset + loc.length);
    // Payload starts with a 4-byte offset to the TIFF header (commonly 6,
    // covering a leading "Exif\0\0"). Trust it, but verify.
    const declared = payload.length >= 4 ? u32(payload, 0, false) : 0;
    let t = findTiffHeader(payload, 4 + declared, 4);
    if (t < 0) t = findTiffHeader(payload, 0, 32);
    return t >= 0 ? payload.subarray(t).slice() : null;
  } catch {
    return null;
  }
}

/**
 * True when a HEIF file records its rotation in the container (an `irot` or
 * `imir` property) rather than only in EXIF.
 *
 * This matters because libheif applies those container transforms while
 * decoding, so the pixels come back upright already. Rotating again from the
 * EXIF tag would turn every portrait photo on its side.
 */
export function heifHasTransform(bytes) {
  try {
    const ipco = findBox(bytes, 0, bytes.length, ['meta', 'iprp', 'ipco']);
    if (!ipco) return false;
    for (const box of boxes(bytes, ipco.body, ipco.bodyEnd)) {
      if (box.type === 'irot' || box.type === 'imir') return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Dispatch on container type. `bytes` is the original, unconverted file. */
export function extractExif(bytes) {
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return exifFromJpeg(bytes);

  // TIFF-based files (DNG, CR2, NEF, ARW, plain TIFF) are one big TIFF
  // structure whose tags point all over the file. Copying it wholesale would
  // blow past the 64KB a JPEG APP1 segment can hold, so the RAW path builds a
  // compact block from decoded metadata instead. See buildExif.
  const magic = u16(bytes, 0, false);
  if ((magic === TIFF_LE && bytes[2] === 0x2a) || (magic === TIFF_BE && bytes[3] === 0x2a)) {
    return null;
  }
  return exifFromHeif(bytes);
}

// ---------------------------------------------------------------- building ---
//
// RAW files carry their metadata in a full TIFF structure that is far too big
// to paste into a JPEG's 64KB APP1 segment, so for those we write a small
// EXIF block from the values the RAW decoder reports. Enough to keep the date,
// the camera and the exposure settings, which is what people actually miss.

const TAG = {
  make: 0x010f, model: 0x0110, orientation: 0x0112, software: 0x0131, dateTime: 0x0132,
  artist: 0x013b, exifPointer: 0x8769,
  exposureTime: 0x829a, fNumber: 0x829d, iso: 0x8827,
  dateTimeOriginal: 0x9003, dateTimeDigitized: 0x9004, focalLength: 0x920a, lensModel: 0xa434,
};

/** Turn a float into a TIFF rational, favoring 1/N for sub-second speeds. */
function toRational(value) {
  if (!isFinite(value) || value <= 0) return null;
  return value >= 1 ? [Math.round(value * 100), 100] : [1, Math.round(1 / value)];
}

function formatExifDate(date) {
  if (!(date instanceof Date) || isNaN(date)) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}:${p(date.getMonth() + 1)}:${p(date.getDate())} ` +
    `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
}

export function buildExif(meta) {
  const encoder = new TextEncoder();
  const ascii = (s) => {
    const body = encoder.encode(String(s).trim());
    const out = new Uint8Array(body.length + 1);   // NUL terminated
    out.set(body);
    return out;
  };
  const short = (v) => { const d = new Uint8Array(2); new DataView(d.buffer).setUint16(0, v & 0xffff, true); return d; };
  const long = (v) => { const d = new Uint8Array(4); new DataView(d.buffer).setUint32(0, v >>> 0, true); return d; };
  const rational = ([n, d]) => {
    const b = new Uint8Array(8); const view = new DataView(b.buffer);
    view.setUint32(0, n >>> 0, true); view.setUint32(4, d >>> 0, true); return b;
  };

  const ifd0 = [];
  const exif = [];
  const addAscii = (list, tag, value) => {
    if (value == null || String(value).trim() === '') return;
    const data = ascii(value);
    list.push({ tag, type: 2, count: data.length, data });
  };
  const addShort = (list, tag, value) => {
    if (!isFinite(value) || value <= 0) return;
    list.push({ tag, type: 3, count: 1, data: short(value) });
  };
  const addRational = (list, tag, value) => {
    const r = toRational(value);
    if (r) list.push({ tag, type: 5, count: 1, data: rational(r) });
  };

  addAscii(ifd0, TAG.make, meta.make);
  addAscii(ifd0, TAG.model, meta.model);
  ifd0.push({ tag: TAG.orientation, type: 3, count: 1, data: short(1) });
  addAscii(ifd0, TAG.artist, meta.artist);
  addAscii(ifd0, TAG.software, 'Just JPEG');

  const stamp = formatExifDate(meta.date);
  addAscii(ifd0, TAG.dateTime, stamp);
  addAscii(exif, TAG.dateTimeOriginal, stamp);
  addAscii(exif, TAG.dateTimeDigitized, stamp);
  addRational(exif, TAG.exposureTime, meta.exposureTime);
  addRational(exif, TAG.fNumber, meta.fNumber);
  addShort(exif, TAG.iso, meta.iso);
  addRational(exif, TAG.focalLength, meta.focalLength);
  addAscii(exif, TAG.lensModel, meta.lens);

  if (!stamp && ifd0.length <= 2 && exif.length === 0) return null;

  // The pointer has to exist before we can size IFD0.
  ifd0.push({ tag: TAG.exifPointer, type: 4, count: 1, data: long(0) });
  ifd0.sort((a, b) => a.tag - b.tag);
  exif.sort((a, b) => a.tag - b.tag);

  const ifd0Size = 2 + ifd0.length * 12 + 4;
  const exifSize = 2 + exif.length * 12 + 4;
  const exifOffset = 8 + ifd0Size;
  const dataStart = exifOffset + exifSize;

  const inline = (e) => e.data.length <= 4;
  const dataSize = [...ifd0, ...exif]
    .filter((e) => !inline(e))
    .reduce((sum, e) => sum + e.data.length + (e.data.length % 2), 0);

  const out = new Uint8Array(dataStart + dataSize);
  const view = new DataView(out.buffer);
  let dataCursor = dataStart;

  out.set([0x49, 0x49], 0);            // "II", little endian
  view.setUint16(2, 0x2a, true);
  view.setUint32(4, 8, true);          // IFD0 starts right after the header

  function writeIfd(entries, at, nextIfd) {
    view.setUint16(at, entries.length, true);
    let p = at + 2;
    for (const e of entries) {
      // The Exif pointer's value is only known now that layout is fixed.
      if (e.tag === TAG.exifPointer) e.data = long(exifOffset);
      view.setUint16(p, e.tag, true);
      view.setUint16(p + 2, e.type, true);
      view.setUint32(p + 4, e.count, true);
      if (inline(e)) {
        out.set(e.data, p + 8);
      } else {
        view.setUint32(p + 8, dataCursor, true);
        out.set(e.data, dataCursor);
        dataCursor += e.data.length + (e.data.length % 2);   // keep word aligned
      }
      p += 12;
    }
    view.setUint32(p, nextIfd, true);
  }

  writeIfd(ifd0, 8, 0);
  writeIfd(exif, exifOffset, 0);
  return out;
}

// -------------------------------------------------------- inject into JPEG ---

/**
 * Pull the ICC color profile out of a HEIF file's `colr` box.
 *
 * This matters more than it sounds. iPhone photos are usually Display P3, and
 * the decoder hands back those P3 pixel values untouched. Writing them into a
 * JPEG with no profile makes every viewer read them as sRGB, which drains the
 * color out of the image. Carrying the profile across keeps it accurate.
 */
export function iccFromHeif(bytes) {
  try {
    const ipco = findBox(bytes, 0, bytes.length, ['meta', 'iprp', 'ipco']);
    if (!ipco) return null;
    for (const box of boxes(bytes, ipco.body, ipco.bodyEnd)) {
      if (box.type !== 'colr') continue;
      const kind = String.fromCharCode(
        bytes[box.body], bytes[box.body + 1], bytes[box.body + 2], bytes[box.body + 3],
      );
      // 'nclx' is a coefficient triple rather than a profile; nothing to copy.
      if (kind !== 'prof' && kind !== 'rICC') continue;
      const profile = bytes.subarray(box.body + 4, box.bodyEnd);
      if (profile.length <= 16) continue;
      // An ICC profile declares its own length up front. Trust that over the
      // box length, which can include padding.
      const declared = u32(profile, 0, false);
      const end = declared > 16 && declared <= profile.length ? declared : profile.length;
      return profile.subarray(0, end).slice();
    }
  } catch { /* no profile is survivable */ }
  return null;
}

const APP2_ICC_HEADER = [0x49, 0x43, 0x43, 0x5f, 0x50, 0x52, 0x4f, 0x46, 0x49, 0x4c, 0x45, 0x00]; // "ICC_PROFILE\0"
const MAX_SEGMENT_PAYLOAD = 0xffff - 2 - APP2_ICC_HEADER.length - 2;

function buildApp1(tiff) {
  const length = 2 + 6 + tiff.length;
  if (length > 0xffff) return null;               // will not fit; ship it bare
  const seg = new Uint8Array(2 + length);
  seg[0] = 0xff; seg[1] = 0xe1;
  seg[2] = (length >> 8) & 0xff; seg[3] = length & 0xff;
  seg.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 4);   // "Exif\0\0"
  seg.set(tiff, 10);
  return seg;
}

function buildApp2Chunks(icc) {
  const total = Math.ceil(icc.length / MAX_SEGMENT_PAYLOAD);
  if (total > 255) return [];                     // spec caps it; profiles never get near
  const segments = [];
  for (let i = 0; i < total; i++) {
    const part = icc.subarray(i * MAX_SEGMENT_PAYLOAD, (i + 1) * MAX_SEGMENT_PAYLOAD);
    const length = 2 + APP2_ICC_HEADER.length + 2 + part.length;
    const seg = new Uint8Array(2 + length);
    seg[0] = 0xff; seg[1] = 0xe2;
    seg[2] = (length >> 8) & 0xff; seg[3] = length & 0xff;
    seg.set(APP2_ICC_HEADER, 4);
    seg[16] = i + 1;        // chunk numbers are 1-based
    seg[17] = total;
    seg.set(part, 18);
    segments.push(seg);
  }
  return segments;
}

/**
 * Rebuild a JPEG with our own metadata segments in front, dropping any APP1
 * or APP2 the encoder already wrote. Returns a new Uint8Array.
 */
export function finalizeJpeg(jpeg, { exif, icc } = {}) {
  const segments = [];
  if (exif && exif.length) {
    const app1 = buildApp1(exif);
    if (app1) segments.push(app1);
  }
  if (icc && icc.length) segments.push(...buildApp2Chunks(icc));
  if (!segments.length) return jpeg;

  // Step past whatever APP1/APP2 blocks the encoder emitted, so the file does
  // not end up carrying two of anything.
  let insertAt = 2;
  while (insertAt + 4 <= jpeg.length && jpeg[insertAt] === 0xff) {
    const marker = jpeg[insertAt + 1];
    if (marker !== 0xe1 && marker !== 0xe2) break;
    insertAt += 2 + ((jpeg[insertAt + 2] << 8) | jpeg[insertAt + 3]);
  }

  const tail = jpeg.subarray(insertAt);
  const size = 2 + segments.reduce((sum, s) => sum + s.length, 0) + tail.length;
  const out = new Uint8Array(size);

  let p = 0;
  out.set(jpeg.subarray(0, 2), p); p += 2;        // SOI
  for (const seg of segments) { out.set(seg, p); p += seg.length; }
  out.set(tail, p);
  return out;
}
