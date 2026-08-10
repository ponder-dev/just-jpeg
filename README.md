# Just JPEG

Turns iPhone HEIC photos and camera RAW files into ordinary JPEGs or PNGs,
thousands at a time. Free, for Mac and Windows, and nothing is uploaded
anywhere.

**[Download it from ponderdev.com](https://ponderdev.com/justjpeg)**

**GPL-3.0 licensed.** Read it, change it, fork it, run it, build on it. You do
not need permission and there is nobody to ask. The one condition is that if
you pass it on, modified or not, it goes with its source under the same
licence, so whoever gets it has the freedoms you did. The LGPL libraries this
builds on keep their own terms as well. See
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

There is no update checker, no telemetry and no network code, so the copy you
build is the copy you keep. That is deliberate: these are meant to be small
tools that do one job and then stop changing.

---

## What it handles

| In | Out |
| --- | --- |
| HEIC, HEIF, AVCI, AVIF | JPEG or PNG |
| Apple ProRAW `.dng`, plus CR2, CR3, NEF, ARW, RAF, ORF, RW2 and friends | JPEG or PNG |
| JPEG, PNG, TIFF, WEBP, BMP, GIF | JPEG or PNG |

Along the way it keeps the things people miss when a converter is careless:

- **Photo details.** Date taken, camera, lens and GPS are carried into the
  JPEG, so a converted library still sorts by when the photo was taken. RAW
  files get a compact EXIF block built from what the decoder reports, because
  a RAW file's own metadata is far too large to fit in a JPEG. That block
  covers date, camera, lens and exposure, but not GPS.
- **Colour.** iPhone photos are usually Display P3. The ICC profile is copied
  across, so converted photos do not come out looking flat.
- **Rotation.** Baked into the pixels and the EXIF tag reset, so nothing lands
  sideways in software that ignores the tag.
- **File dates.** Optional, on by default.
- **Full colour detail, if you want it.** See below.

### About quality

The browser's JPEG encoder is fast, but it always writes 4:2:0 chroma, which
throws away half the colour resolution. Measured against a losslessly decoded
reference, that puts a hard ceiling on quality no matter how high the slider
goes:

| Quality setting | 4:2:0 (default) | 4:4:4 (highest quality) |
| --- | --- | --- |
| 85 | 32.8 dB | 34.9 dB |
| 92 | 35.2 dB | 38.3 dB |
| 98 | 37.5 dB | 45.4 dB |

4:2:0 flattens out around 37 dB. 4:4:4 keeps climbing. So **Highest quality**
in the settings switches the encoder to mozjpeg with full 4:4:4 chroma. On a
real photo at quality 92 that measured 36.2 dB against 32.7 dB for the default,
for roughly 45 percent more file size and about five times the encoding time.

Leave it off for holiday snaps. Turn it on when the JPEG is replacing the
original.

## The command line

```sh
npm install -g github:ponder-dev/just-jpeg
justjpeg photos/ --size 2000
cat IMG_0123.heic | justjpeg > IMG_0123.jpg
```

Reads HEIC, JPEG, PNG, TIFF and WEBP; writes JPEG (default) or PNG. Folders
recurse, metadata rides across with orientation baked upright, `--strip`
removes it, and an existing output is renamed rather than replaced. Runs
anywhere node does, Linux included.

**The one difference from the app, on purpose: no camera RAW.** The RAW
decoder is a web-only build that needs browser workers to run, and it does not
survive plain node. Point RAW files at the app, which converts them fully. The
command line says this in `--help`, says it again if you hand it a `.dng`, and
leaves the file alone rather than failing strangely. GIF and BMP input are
app-only for the same reason: the app decodes them with the browser's own
decoder, and shipping a third wasm codec each for formats nobody shoots photos
in was not worth the weight.

The decoders, the EXIF handling and the output rules are shared with the app,
not reimplemented: `src/sniff.js`, `src/exif.js` and `src/paths.js` are the
same files the app bundles. What the command line has of its own is
`src/pixels.js`, the orientation transform the app does on a canvas, tested
against an independent implementation of all eight EXIF orientations.

## Your originals are safe

Just JPEG only ever writes new files. It has no delete and no move. It will
not overwrite the file it is reading from, even when you choose "Replace it",
because converting a JPEG to a JPEG in place would otherwise resolve onto the
original. That rule is enforced in `src/paths.js` and covered by
`test/paths.test.mjs`.

Writes go to a temporary file and are renamed into place, so an interrupted
run cannot leave a half written image where a good one should be.

## No updates, no telemetry, no account

There is no update checker, no analytics and no network code of any kind. The
app opens files you point it at and writes files next to them. That is all it
does.

---

## How it works

The hard part is that HEIC decoding is not available anywhere useful.
`sharp`'s prebuilt libvips accepts only AVIF for HEIF input, and macOS's `sips`
is not on Windows. So decoding is done in WebAssembly, which behaves the same
on both platforms:

```
main process          renderer                worker pool (one per core, max 6)
------------          --------                ---------------------------------
scan folders     ->   queue                ->  libheif  (HEIC/HEIF)   \
read bytes                                     LibRaw   (camera RAW)   > RGBA
plan output path                               UTIF     (plain TIFF)  /
write file       <-   collect results      <-  OffscreenCanvas -> JPEG/PNG
                                               mozjpeg 4:4:4 when asked
```

Encoding goes through the browser's own encoder rather than a JavaScript one.
It is native code, and it is roughly ten times faster than mozjpeg compiled to
WASM, which was the alternative.

Roughly 2 seconds per 12 megapixel HEIC per worker, so about 12 minutes for
3000 photos on an 8 core machine.

## Building it

Needs Node 22. There is an `.nvmrc`.

```sh
npm install
npm start          # run it
npm test           # path rules, pixels, the CLI, then every fixture through the app
npm run test:linux # the command line on real linux, in docker
npm run dist:mac   # universal .dmg
npm run dist:win   # .exe installer and portable build
npm run dist:linux # AppImage and tar.gz
```

`npm run bundle` compiles `src/` into `app/`, which is the only thing that gets
packaged. Nothing from `node_modules` ships: esbuild inlines libheif and UTIF,
and LibRaw is copied into `app/renderer/vendor` because it starts its own
worker and loads a sidecar `.wasm`.

### Layout

```
src/main.js               window, menus, and every filesystem operation
src/preload.js            the only bridge between the UI and the disk
src/paths.js              where output files land, and the rules protecting originals
src/exif.js               EXIF and ICC: reading, building, embedding
src/render.js             EXIF rotation and downscaling
src/renderer/app.js       UI and the worker pool
src/renderer/convert.worker.js   decode, draw, encode
scripts/bundle.mjs        src/ -> app/
test/paths.test.mjs       pure unit tests, plain node
test/selftest.cjs         real conversions in real Electron, checked against fixtures
```

### Tests

`test/paths.test.mjs` covers the rules that keep originals safe.

`test/selftest.cjs` runs the actual worker inside Electron over
`test/fixtures/`, checking dimensions, container validity, EXIF survival, ICC
survival, real chroma sampling read from the JPEG header, and all eight EXIF
orientations against a known 2x2 image. WASM and OffscreenCanvas do not exist
in plain Node, so this has to run in Electron.

The fixtures committed here are generated patterns with no third-party content
in them. The real photographs and camera RAW files used for testing come from
public sample sets and are not ours to republish, so they are fetched instead:

```sh
node scripts/fetch-fixtures.mjs
```

Any case whose fixture is missing is skipped rather than failed, so the suite
still runs without them. CI fetches them so the RAW and real-photo paths stay
covered.

## Releasing

Builds happen in GitHub Actions, because Windows installers cannot be built on
a Mac without wine.

```sh
npm version patch && git push --follow-tags
```

That runs the tests on both platforms, builds the installers and opens a draft
release. Asset names deliberately have no version in them, so the download
links on ponderdev.com keep working forever.

### The builds are unsigned

A Developer ID is 99 USD a year and a Windows certificate is more, which is
hard to justify for a free tool. So the first launch needs one extra step:
right click and Open on a Mac, or "More info" then "Run anyway" on Windows.
If that ever changes, set `identity` and `notarize` in `electron-builder.yml`.

## Licence

Just JPEG is GPL-3.0-or-later. See [LICENSE](LICENSE).

GPL rather than something permissive on purpose. Anyone can use this, change
it and even charge for it, but they cannot close it: whatever they hand on has
to carry its source under the same terms. That keeps it useful to people
rather than useful to repackage.

LibRaw is LGPL 2.1 without an "or later" clause, which usually blocks GPL-3.
Its section 3 allows converting to a newer GPL, which is what makes this
combination work.

It stands on libheif, libde265 and LibRaw, which are LGPL, plus mozjpeg, UTIF,
pako and Electron. Every one of them is credited with its full licence text in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) and inside the app under
**Help > Licences and credits**.
