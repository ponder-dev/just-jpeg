// LibRaw for node: the shim (rawshim.js), then the package's own build.
// Apart from raw.js because the app's worker bundles that one for the browser
// and this one is node only. Imported on first use, so a HEIC run never pays
// for it.

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { installRawShim } from './rawshim.js';

export async function loadLibRawInNode() {
  installRawShim();
  const entry = createRequire(import.meta.url).resolve('libraw-wasm/dist/index.js');
  return (await import(pathToFileURL(entry).href)).default;
}
