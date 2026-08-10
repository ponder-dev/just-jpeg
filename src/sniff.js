// Deciding how to decode, from the bytes rather than the file extension.
//
// Shared between the conversion worker and the command line, so both agree on
// what a file is. Pure: bytes in, a word out.

const HEIF_BRANDS = new Set([
  'heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs',
  'mif1', 'msf1', 'avif', 'avis', 'mia1', 'mia3', 'avci',
]);

function fourCC(b, o) {
  return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
}

/**
 * 'native'  the browser (or a wasm codec) reads it directly: JPEG, PNG, GIF, BMP, WEBP
 * 'heif'    HEIC and friends
 * 'raw'     TIFF-shaped: camera RAW, or an ordinary TIFF (the caller tries both)
 * 'unknown' not an image we recognise
 */
export function sniff(b) {
  if (b.length < 12) return 'unknown';
  if (b[0] === 0xff && b[1] === 0xd8) return 'native';                       // JPEG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'native';
  if (fourCC(b, 0) === 'GIF8') return 'native';
  if (b[0] === 0x42 && b[1] === 0x4d) return 'native';                       // BMP
  if (fourCC(b, 0) === 'RIFF' && fourCC(b, 8) === 'WEBP') return 'native';
  if (fourCC(b, 4) === 'ftyp') {
    return HEIF_BRANDS.has(fourCC(b, 8).toLowerCase()) ? 'heif' : 'raw';     // crx (CR3) lands in raw
  }
  if (fourCC(b, 0).startsWith('FUJI')) return 'raw';                          // RAF
  const le = b[0] === 0x49 && b[1] === 0x49;
  const be = b[0] === 0x4d && b[1] === 0x4d;
  if (le || be) return 'raw';   // TIFF-based: DNG, CR2, NEF, ARW, ORF, RW2...
  return 'unknown';
}
