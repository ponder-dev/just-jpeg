// Prints the size and a sha256 of the pixels the shared RAW decoder returns
// for one file, in node. The self-test runs it under the app's own runtime
// (ELECTRON_RUN_AS_NODE) and compares with what the window's decoder gets.
//
//   node test/raw-hash.mjs file.dng

import crypto from 'node:crypto';
import fs from 'node:fs';
import { decodeRaw } from '../src/raw.js';
import { loadLibRawInNode } from '../src/raw-node.js';

const out = await decodeRaw(new Uint8Array(fs.readFileSync(process.argv[2])), { loadLibRaw: loadLibRawInNode });
console.log(JSON.stringify({
  width: out.width,
  height: out.height,
  sha256: crypto.createHash('sha256').update(out.data).digest('hex'),
  make: out.meta && out.meta.make,
}));
