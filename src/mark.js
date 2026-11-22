// The mark Just JPEG puts on every picture it writes, and the reader that
// finds it again.
//
// "Replace it" may only replace a file Just JPEG made, so each file it writes
// carries a short fixed text: a JPEG comment (COM) segment placed after the
// APP segments, a PNG tEXt chunk with the keyword Software. The text holds
// nothing about the person, the machine, the version or the time. Photos that
// are copied in as they are carry no mark: they are the person's own.

export const MARK_TEXT = 'Just JPEG';
const TEXT = new TextEncoder().encode(MARK_TEXT);
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_KEYWORD = new TextEncoder().encode('Software\0');

/** The JPEG COM segment: FF FE, length 2 + text, the text. */
export function jpegMarkSegment() {
  const seg = new Uint8Array(4 + TEXT.length);
  seg[0] = 0xff; seg[1] = 0xfe;
  seg[2] = 0; seg[3] = 2 + TEXT.length;
  seg.set(TEXT, 4);
  return seg;
}

let crcTable;
function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The PNG tEXt chunk: Software, a zero byte, the text. */
export function pngMarkChunk() {
  const data = new Uint8Array(PNG_KEYWORD.length + TEXT.length);
  data.set(PNG_KEYWORD, 0);
  data.set(TEXT, PNG_KEYWORD.length);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set([0x74, 0x45, 0x58, 0x74], 4);           // "tEXt"
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

/** A JPEG with the mark after its APP segments (EXIF, colour profile). */
export function markJpeg(jpeg) {
  let at = 2;
  while (at + 4 <= jpeg.length && jpeg[at] === 0xff && jpeg[at + 1] >= 0xe0 && jpeg[at + 1] <= 0xef) {
    at += 2 + ((jpeg[at + 2] << 8) | jpeg[at + 3]);
  }
  if (at > jpeg.length) return jpeg;
  const seg = jpegMarkSegment();
  const out = new Uint8Array(jpeg.length + seg.length);
  out.set(jpeg.subarray(0, at), 0);
  out.set(seg, at);
  out.set(jpeg.subarray(at), at + seg.length);
  return out;
}

/** A PNG with the mark chunk straight after IHDR. */
export function markPng(png) {
  const at = 8 + 12 + 13;                            // signature, then IHDR whole
  if (png.length < at) return png;
  const chunk = pngMarkChunk();
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, at), 0);
  out.set(chunk, at);
  out.set(png.subarray(at), at + chunk.length);
  return out;
}

export function markFor(format, bytes) {
  return format === 'png' ? markPng(bytes) : markJpeg(bytes);
}

/**
 * True when the file carries the mark. `read(position, length)` returns bytes
 * (possibly fewer at the end). Only segment and chunk headers are read, never
 * the picture, so the cost is a handful of tiny reads.
 */
export function hasMark(read) {
  const first = read(0, 8);
  if (first.length >= 2 && first[0] === 0xff && first[1] === 0xd8) {
    let at = 2;
    for (let i = 0; i < 64; i++) {
      const h = read(at, 4);
      if (h.length < 4 || h[0] !== 0xff) return false;
      const marker = h[1];
      const length = (h[2] << 8) | h[3];
      if (marker === 0xfe) {
        if (length - 2 !== TEXT.length) { at += 2 + length; continue; }
        const body = read(at + 4, TEXT.length);
        if (body.length === TEXT.length && body.every((b, j) => b === TEXT[j])) return true;
      } else if (marker < 0xe0 || marker > 0xef) {
        return false;                                // past the headers: no mark
      }
      at += 2 + length;
    }
    return false;
  }
  if (first.length === 8 && PNG_SIGNATURE.every((b, j) => first[j] === b)) {
    let at = 8;
    for (let i = 0; i < 32; i++) {
      const h = read(at, 8);
      if (h.length < 8) return false;
      const length = ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
      const type = String.fromCharCode(h[4], h[5], h[6], h[7]);
      if (type === 'tEXt' && length === PNG_KEYWORD.length + TEXT.length) {
        const body = read(at + 8, length);
        const want = [...PNG_KEYWORD, ...TEXT];
        if (body.length === length && want.every((b, j) => body[j] === b)) return true;
      }
      if (type === 'IDAT' || type === 'IEND') return false;
      at += 12 + length;
    }
  }
  return false;
}

export function hasMarkInBytes(bytes) {
  return hasMark((pos, len) => bytes.subarray(pos, pos + len));
}
