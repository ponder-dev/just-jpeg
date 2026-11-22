// The camera RAW files the command line is tested on, one per maker, from the
// RAW sample archive at https://raw.pixls.us/ (all CC0, public domain; see
// THIRD-PARTY-NOTICES.md). Not in the repository: scripts/fetch-fixtures.mjs
// downloads each into test/fixtures/raw/ and checks the sha256 below.
//
// width and height are what LibRaw returns, which is already upright;
// `flip` is the camera's orientation flag it read (5 and 6 are portrait
// shots), so a portrait file must come out taller than wide, never turned a
// second time.

export const RAW_FIXTURES = [
  { file: 'adobe-dng-converter-canon5dm3.dng', id: 1033, sha256: 'b22f1e36331f679abb8b13e433b9bbde3988723adf10fee7aa0dda6381016a98', width: 3960, height: 2640, flip: 0, why: 'Adobe DNG (Canon 5D Mark III, converted)' },
  { file: 'apple-iphone12pro-proraw-portrait.dng', id: 4264, sha256: 'e91e77a4533ed7cce551d83330676ea5c47dd5e55fb38adda7819366afdbdfc2', width: 3024, height: 4032, flip: 6, why: 'Apple ProRAW DNG, portrait' },
  { file: 'canon-rebel-xt-portrait.cr2', id: 1230, sha256: '4b47ba27c0090efa091aaf99babc76d9a3e6f6f121b443d6c58c3ce7275cd770', width: 2314, height: 3474, flip: 5, why: 'Canon CR2, portrait' },
  { file: 'canon-eos-r6.cr3', id: 4659, sha256: '74abb0a113d075ad9887a058082f40dd2a938c4813a08474d82356f11a027778', width: 3407, height: 2271, flip: 0, why: 'Canon CR3' },
  { file: 'nikon-d70s.nef', id: 1117, sha256: '6c46f9854033e7623ebbb5de8c951df6762ca44f05d45035ccc5cb7e9f4e5692', width: 3039, height: 2014, flip: 0, why: 'Nikon NEF' },
  { file: 'sony-a100.arw', id: 2346, sha256: '4df7981ac4baec9648b4f106751ea4b09a6e27bc70a15f8ef09bec051fec362d', width: 3881, height: 2607, flip: 0, why: 'Sony ARW' },
  { file: 'fujifilm-s5000.raf', id: 2726, sha256: 'dabd5e74521a6980156be9fd4b88d0c37b0fe4d0e0e6f5c12db8cffff1b76297', width: 2012, height: 1521, flip: 0, why: 'Fujifilm RAF' },
  { file: 'olympus-c5060wz.orf', id: 1799, sha256: '3fc12bc3f6320cfab456111d7805b446e329fdd1907680be55e2e163e5e084bd', width: 2608, height: 1950, flip: 0, why: 'Olympus ORF' },
  { file: 'panasonic-lx7.rw2', id: 7010, sha256: '18dfc3877e944020299635a8c2fad61fca2485b1c9b67645a495ee870a86e599', width: 1904, height: 1276, flip: 0, why: 'Panasonic RW2' },
].map((f) => ({ ...f, url: `https://raw.pixls.us/getfile.php/${f.id}/nice/` }));
