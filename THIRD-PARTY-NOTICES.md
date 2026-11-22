# Third party notices

Just JPEG is built on other people's work. This file records what it uses,
under what terms, and where to get the original source. Full licence texts are
in the `licenses/` folder and are also shown inside the app under
**Help > Licences and credits**.

Just JPEG itself is GPL-3.0-or-later. See `LICENSE`.

---

## libheif and libde265

Reads HEIC and HEIF files. This is the part that opens photos from an iPhone.

- Bundled through [libheif-js](https://github.com/catdad-experiments/libheif-js),
  which compiles [libheif](https://github.com/strukturag/libheif) to WebAssembly.
- HEVC decoding inside libheif is done by
  [libde265](https://github.com/strukturag/libde265), which is compiled into
  the same WebAssembly build and is a separate project with its own copyright.
- **Licence: GNU LGPL v3** for both, with MIT covering the sample apps and
  wrappers of each.
- Full texts: `licenses/libheif.txt` and `licenses/libde265.txt`

## LibRaw

Reads camera RAW files, including Apple ProRAW `.dng`.

- Bundled through [LibRaw-Wasm](https://github.com/ybouane/LibRaw-Wasm), whose
  own wrapper code is ISC licensed.
- The decoder it compiles is [LibRaw](https://www.libraw.org/), which is
  dual licensed: **GNU LGPL v2.1** or CDDL v1.0. Just JPEG relies on the LGPL
  v2.1 option.
- LibRaw includes code derived from Dave Coffin's dcraw.
- Full text: `licenses/libraw-lgpl-2.1.txt`
- How each side loads it: the app copies the package's build, as it is, into
  `app/renderer/vendor/libraw/` and runs it in a web worker. The command line
  (`justjpeg` from npm, or the one inside the app) loads the same package from
  `node_modules/libraw-wasm/` in node, where `src/rawshim.js` and
  `src/rawshim-worker.js`, our own small files over node's `worker_threads`,
  give it the workers and file loading a browser would. The decoder is not
  modified in either place.

## mozjpeg

Encodes the "highest quality" JPEGs. The browser's own encoder always writes
4:2:0 chroma, which permanently halves color resolution and caps quality at
around 37dB PSNR however high the quality slider goes. mozjpeg can write full
4:4:4 chroma, so it is used when maximum quality is asked for.

- Bundled through [jSquash](https://github.com/jamsinclair/jSquash), which is
  **Apache 2.0** licensed. Full text: `licenses/jsquash-apache-2.0.txt`
- The encoder itself is [mozjpeg](https://github.com/mozilla/mozjpeg), built on
  libjpeg-turbo. **Licence: the IJG licence plus two BSD style licences.**
  Full text: `licenses/mozjpeg.txt`
- jSquash's own codec notice is in `licenses/jsquash-codec-notice.txt`.

## UTIF.js

Reads ordinary TIFF files, the kind scanners produce, which LibRaw declines.

- [UTIF.js](https://github.com/photopea/UTIF.js) by Photopea.
- **Licence: MIT**. Full text: `licenses/utif.txt`

## pako

zlib in JavaScript, used by UTIF to inflate compressed TIFF data.

- [pako](https://github.com/nodeca/pako).
- **Licence: MIT and Zlib**. Full text: `licenses/pako.txt`

## jSquash codecs (command line)

The `justjpeg` command cannot use the browser's encoder, so it carries wasm
codecs from the [jSquash](https://github.com/jamsinclair/jSquash) project:
`@jsquash/jpeg` (also used by the app for its highest-quality mode),
`@jsquash/png`, `@jsquash/webp` and `@jsquash/resize`. These wrap the Squoosh
codecs: mozjpeg, and rust PNG/resize crates.

- **Licence: MIT / Apache-2.0** for the wrappers; mozjpeg keeps its own
  BSD-style terms, in `licenses/mozjpeg.txt`.

## Electron and Chromium

The application shell, and the JPEG and PNG encoders.

- [Electron](https://github.com/electron/electron), **MIT licensed**.
- Electron bundles Chromium and Node.js. Their combined licence text ships
  inside the app as `LICENSES.chromium.html`.

---

## Meeting the LGPL terms

libheif, libde265 and LibRaw are LGPL. Distributing them inside an application
carries obligations, and Just JPEG meets them like this:

0. **Compatibility.** Just JPEG is GPL-3.0-or-later, which LGPL is designed to
   combine with. LibRaw is LGPL 2.1 with no "or later" clause, but its section
   3 permits converting to a newer GPL, which is what makes this legitimate.
1. **Notice.** This file, plus the in-app credits screen, names each library
   and its licence.
2. **Licence texts.** Shipped in full, both in `licenses/` and inside the app.
3. **Source.** Each project is linked above. None of them were modified for
   Just JPEG; the published builds are used as-is.
4. **Relinking.** Just JPEG's own source is published, and the libraries are
   ordinary npm dependencies. The app uses them as `scripts/bundle.mjs` copies
   or bundles them; the command line loads them from `node_modules` at run
   time, LibRaw included (`libraw-wasm/dist/`, loaded by `src/raw-node.js`).
   Anyone can swap in their own build of libheif or LibRaw, by replacing the
   package in `node_modules` for the command line or with
   `npm install && npm run dist` for the app.

## A note on HEVC patents

HEIC photos store their image data as HEVC, which is covered by patents in some
countries. Just JPEG decodes HEVC with libde265, an independent open source
decoder, and never encodes HEVC. Apple licenses HEVC for the devices that
create these files. If you are redistributing Just JPEG commercially or at
scale, take your own advice on what that means where you operate.

## Test files from raw.pixls.us

The camera RAW files the tests use (one per maker: Canon, Nikon, Sony, Fujifilm,
Olympus, Panasonic, Adobe DNG and Apple ProRAW) come from the RAW sample
archive at <https://raw.pixls.us/>, whose samples are released under
**Creative Commons Zero (CC0 1.0, public domain)**. They are not in this
repository: `scripts/fetch-fixtures.mjs` downloads them, checks each against a
SHA-256 and git-ignores them. Nothing from them ships in the app or the npm
package.

## A test photo from pillow_heif

One HEIC photo the tests use (`s1.heic`, an iPhone photo of a pug) comes from
the tests of pillow_heif, <https://github.com/bigcat88/pillow_heif>, under the
**BSD 3-Clause** licence, copyright 2021-2023 the Pillow-Heif contributors. It is
fetched and checked the same way, and nothing from it ships either.
