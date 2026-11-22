# Just JPEG

Turns iPhone HEIC photos and camera RAW files into ordinary JPEGs or PNGs,
thousands at a time. Free, for Mac, Windows and Linux, and nothing is uploaded
anywhere.

**[Download it from ponderdev.com](https://ponderdev.com/justjpeg)**

**GPL-3.0-or-later licensed.** Read it, change it, fork it, run it, build on it. You do
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
- **Color.** iPhone photos are usually Display P3. The ICC profile is copied
  across, so converted photos do not come out looking flat.
- **Rotation.** Baked into the pixels and the EXIF tag reset, so nothing lands
  sideways in software that ignores the tag.
- **File dates.** Optional, on by default.
- **Full colour detail, if you want it.** See below.

### About quality

The browser's JPEG encoder is fast, but it always writes 4:2:0 chroma, which
keeps only half the colour resolution. That puts a ceiling on quality no matter
how high the slider goes. **Highest quality** in the settings switches the
encoder to mozjpeg with full 4:4:4 chroma, which keeps all of it, for a larger
file and a slower conversion. The self-test reads the sampling factors out of
the JPEG header to check that the switch really does what it says.

Leave it off for holiday snaps. Turn it on when the JPEG is replacing the
original.

## The command line

```sh
npm install -g @ponderdev/justjpeg
justjpeg photos/ --size 2000
cat IMG_0123.heic | justjpeg > IMG_0123.jpg
```

Reads HEIC, HEIF, JPEG, PNG, TIFF and WEBP; writes JPEG (default) or PNG. Folders
recurse, metadata rides across with orientation baked upright, `--strip`
removes it, and an existing output is renamed rather than replaced. A folder's
results go into a new folder beside it (`Holiday (JPEG)`, subfolders mirrored,
the folder itself untouched, photos already JPEG copied in so it is complete);
`--beside` saves each beside its original, and
`-o` writes into a folder of your choosing. Runs
anywhere node 22 or newer does, Linux included. No ffmpeg needed.

**Camera RAW works here too, with the app's own decoder.** DNG (Apple ProRAW
included), CR2, CR3, NEF, ARW, RAF, ORF, RW2 and the other formats the app
takes go through the same LibRaw, the same code (`src/raw.js`), so a file comes
out the same from either. LibRaw is a browser build that starts its own
workers, so `src/rawshim.js`, a small file of ours over node's
`worker_threads`, gives it those in node; nothing else is installed. RAW is
decoded one file at a time (a big one is hundreds of megabytes once decoded),
and a decode that stops answering is given up after three minutes with a plain
message instead of hanging. The photo comes out upright, with date, camera,
lens and exposure carried and no location, as in the app. AVIF, GIF and BMP
input are app-only: the app decodes them with the browser's own decoder, and
shipping another wasm codec each for them was not worth the weight. The command
line names an AVIF as the app's and leaves it alone; a GIF or BMP it does not
pick up at all.

### For scripts and assistants

- `--json` prints one JSON line per file, then a `done` line: a `result`
  (converted), a `skip` (an output that would land on the original
  itself, or a file that looks like an earlier result) or an `error`. An output
  name that is merely taken is not a skip: it is written as `name 2.jpg`, or
  replaced with `--overwrite`, which replaces only a file Just JPEG itself made
  and never an original, a real photo of yours or a file among the ones being
  converted (those still get `name 2.jpg`).
- A file that looks like an earlier result is skipped with
  `reason: earlier-output` (and `from`): a file in the output format beside a
  photo of the same name in another format (`photo.jpg` by `photo.heic`), or
  that name with ` 2`, ` 3` after it, when saving beside the originals. It goes
  by name alone, so a real edited `IMG_0001.JPG` kept beside `IMG_0001.HEIC` is
  skipped too (exit 0, a line on stderr): name it on its own to convert it.
- JPEG has no see-through: transparent areas of a PNG, WebP or TIFF turn
  white, in the app and here. `-f png` keeps them. A TIFF's own orientation and
  colour profile are applied and carried across, and the size in carried-over
  EXIF is updated to the new picture's.
- Piped input (`cat photo.heic | justjpeg -f png > photo.png`) works with any
  format; `--json` prints nothing then, because stdout is the image.
  Bad options and a missing input are JSON errors too.
- `--describe` prints every option, its type, range and default, and the exit
  codes, as JSON, so nothing has to be guessed from `--help`.
- `--dry-run` lists what would be written and writes nothing.
- `--help`, `--version` and `--describe` answer at once and do nothing else.
- The desktop app carries this command line inside it, so the tool belt can
  run it without anything else installed.

Exit status: **0** done, **1** nothing converted, **2** a bad option or no
input (nothing was started), **3** some files converted and some failed.

**Changed in 1.2.0**, for anyone with a script from before: some files failing
is now 3 (it was 2, which is now a usage error), and `--json` ends with a
`done` line, so read the lines one at a time. The fields in each file's line
are the same as before.

The window and the command line run one engine, `src/engine.js`, not two
copies of it: the settings and their limits, which files count, where every
result goes and what is skipped or never replaced, how a picture is turned and
sized, what travels into the file (details, colour profile, the Just JPEG
mark), and the words for a failure or a skip. `src/sniff.js`, `src/exif.js`,
`src/mark.js` and `src/paths.js` are the same files the app bundles, and the
engine itself runs in the app's conversion worker and in node alike. What each
side keeps is only what is not a decision: the drawing (the app on a canvas,
the command line in `src/pixels.js` with `@jsquash/resize`, tested against an
independent implementation of all eight EXIF orientations), the codecs each
loads, and its own file and terminal I/O. `test/engine.test.mjs` fails if
either side grows a private copy of a decision.

### For Claude and other assistants

The package carries an agent skill, `agents/skills/justjpeg/SKILL.md`, that
tells an AI assistant when to reach for Just JPEG and how to drive it. Installing
the command line with `npm install -g` links it in for the assistants set up on
the machine: into Claude Code's skills folder (`~/.claude/skills/justjpeg`, or
under `$CLAUDE_CONFIG_DIR`), and into `~/.agents/skills/justjpeg`, the shared
folder that Codex, Gemini CLI, Copilot, Cursor, OpenCode, Amp and Goose read.
If one of those assistants is set up but `~/.agents` is not there yet, the
install makes `~/.agents/skills` for the link. Updating the package updates the
skill with it. It never replaces a folder, or a link of your own (even one
pointing at a folder that has moved); the one link it does replace is the one an
earlier install of this tool left. `npm install -g --ignore-scripts` skips it all.
After uninstalling, remove the leftover links with
`rm ~/.claude/skills/justjpeg ~/.agents/skills/justjpeg`.

## Your originals are safe

Every picture Just JPEG writes carries a small mark: a JPEG comment, or a PNG
text entry, reading `Just JPEG` (nothing else: no name, date or version).
"Replace it" and `--overwrite` replace only a file with that mark. A photo of
yours with the same name has none, so it is kept and the result is `name 2.jpg`.
Photos copied in as they are carry no mark.

Just JPEG only ever writes new files. It has no delete and no move. It will
not overwrite the file it is reading from, even when you choose "Replace it",
because converting a JPEG to a JPEG in place would otherwise resolve onto the
original. That rule is enforced in `src/paths.js` and covered by
`test/paths.test.mjs` (never writing over the file it reads, and "Replace it"
and `--overwrite` leaving a photo of yours alone), `test/engine.test.mjs`
('replacing: only a picture Just JPEG made, never an original or a file in the
batch') and `test/cli.test.mjs` (the two `--overwrite` tests).

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

Measured on an Apple Silicon laptop (M5 Max), with the machine busy with other
work: the app takes about 2.5 seconds for a 12 megapixel HEIC on one worker
(the self-test prints it), and about 4.7 seconds for a 24 megapixel camera RAW. The command line decoded the 8 megapixel DNG in the tests in about 4 seconds, worker start-up included (timed once).
The pool runs up to six workers, so 3000 such HEICs would take in the region of
20 minutes; that is arithmetic from the per-photo time, not a timed run.
Smaller photos are much quicker. The command line does one photo at a time and
is slower, about 8 seconds of processor time for the same 12 megapixel HEIC.

## Building it

Needs Node 22.12 or newer. There is an `.nvmrc`.

```sh
npm ci
npx install-electron # Electron 43 has no postinstall, see below
npm start          # run it
npm test           # path rules, pixels, the CLI, then every fixture through the app
npm run test:linux # the command line on real linux, in docker
npm run dist:mac   # universal .dmg
npm run dist:win   # .exe installer and portable build
npm run dist:linux # AppImage and tar.gz
npm run icon       # build/icon.svg, then every icon size rendered from it
```

**`npx install-electron` gets the binary now.** Electron 43 dropped its
postinstall script, so `npm ci` completes in seconds and downloads none of the
295MB binary. Electron fetches it the first time it starts instead, which needs
a network connection and Node 22.12 at that moment. Running the installer up
front gets that over with while you are watching.

`npm run bundle` compiles `src/` into `app/`, which is the only thing that gets
packaged. The window needs nothing from `node_modules`: esbuild inlines libheif
and UTIF, and LibRaw is copied into `app/renderer/vendor` because it starts its
own worker and loads a sidecar `.wasm`. The command line, which ships beside it,
loads its packages from `node_modules` (LibRaw included, a runtime dependency
for that reason).

### Layout

```
src/main.js               window, menus, and every filesystem operation
src/preload.js            the only bridge between the UI and the disk
src/paths.js              where output files land, and the rules protecting originals
src/exif.js               EXIF and ICC: reading, building, embedding
src/render.js             EXIF rotation and downscaling
src/renderer/app.js       UI and the worker pool
src/renderer/convert.worker.js   decode, draw, encode
src/raw.js                      camera RAW to pixels, for the worker and the command line
src/rawshim.js, rawshim-worker.js, raw-node.js
                                LibRaw's workers and file loading in node
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

On your own machine a case whose fixture is missing is left out, and the
self-test says so, so the suite still runs without them. In CI (`CI` is set) a
missing fixture fails the run and a failed download stops it, so no RAW format
can pass by not running. The fetched set has one file for each of DNG, CR2, NEF,
ARW, RAF, ORF and RW2 for the app (public domain samples from raw.pixls.us), and
nine more in `test/fixtures/raw/` for the command line (`test/raw.test.mjs`):
Adobe DNG, Apple ProRAW and Canon CR2 (both portrait), CR3, NEF, ARW, RAF, ORF
and RW2, each checked against a sha256. They are CC0, and the tests check that
each comes out the right size and that a portrait shot stays portrait.

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

## On Linux

Unpack the .tar.gz and run `./justjpeg` in the folder; the AppImage needs only to be made executable. Both start the app with Chromium's sandbox where your system allows it, and without it where it does not, because Ubuntu 24.04 forbids the user namespaces the sandbox needs and the program file inside the .tar.gz (`justjpeg-app`) then stops at once with a "SUID sandbox helper" error unless given `--no-sandbox`. To put Just JPEG in your applications menu with its icon, run `./install-desktop-entry.sh` in the unpacked folder (again if you move it).

## Keeping an older version

Installing a new version the usual way replaces the old one. To keep both:

- **Mac:** rename the old app in Applications first (to "Just JPEG 1.2.0", say), then install the new one. Both open, side by side.
- **Windows:** the installer replaces the old version, so use the portable download instead (the .exe, or the .zip), each version in its own folder.
- **Linux:** each AppImage is its own file, so keep the old one beside the new. The .tar.gz works the same way, in its own folder.

The two versions share your settings. A newer version's settings are kept when the older one saves, and the older one ignores what it does not know.

## Licence

Built with kit 1.0.0, the parts every Just tool shares (the start screen, the
run, the footer, the folder intake), from PonderDev's tools workshop. The app's
licences page and `justjpeg --describe` (`"kit"`) say the same.

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
