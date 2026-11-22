---
name: justjpeg
description: Convert iPhone HEIC photos (and HEIF, AVIF, WEBP, TIFF, PNG, JPEG) to JPEG or PNG with Just JPEG (`justjpeg`), PonderDev's free command line and app, one file or thousands at a time, keeping the date and camera details. Use when the user wants to open, share, upload or edit photos in a format something won't take: "convert these HEIC files to JPG", "my iPhone photos won't open", "turn this folder of HEICs into JPEGs", "make these webp files PNG", "shrink these photos to 2000 pixels", "strip the location from these photos". Runs entirely on the user's machine. Covers checking it's installed, building the command, reading its JSON result, and reporting back.
---

# Converting photos with Just JPEG

**Just JPEG** (`justjpeg`) converts HEIC photos, and HEIF, AVIF, WEBP, TIFF,
PNG and JPEG, to JPEG or PNG, keeping the date and camera details. It is
PonderDev's free tool: page https://ponderdev.com/justjpeg, source
`ponder-dev/just-jpeg`. Use it instead of hand-rolled ImageMagick or `sips`
loops: it handles folders, never writes over an original, and needs nothing
else installed.

## Is it installed?

    command -v justjpeg && justjpeg --version

If not, the command line installs with `npm install -g @ponderdev/justjpeg`
(Node 22 or newer). It needs nothing else. Ask before installing anything.

**Camera RAW files** (`.cr2`, `.cr3`, `.nef`, `.arw`, `.dng` and the rest) convert
on the command line too, with the same decoder as the app. They go one at a time
and a big one takes several seconds, so a folder of RAW is slow: say so, and do
not run it twice. AVIF, GIF and BMP are the app's only, from the page's download
button; say so rather than trying another tool behind the user's back.

`justjpeg --help` and `justjpeg --describe` only print, so they're safe to run.

## Build the command

    justjpeg ~/Pictures/iphone-export --json
    justjpeg IMG_0123.heic IMG_0124.heic -f png --json
    justjpeg ~/Pictures/trip -s 2000 --strip --json
    justjpeg ~/Pictures/trip --beside --json

- Give it files, folders, or both. A folder converts the pictures in it, subfolders too.
- A file named on its own gets its result beside it as `name.jpg` (or
  `.png`), and `name 2.jpg` if that's taken; the original is only ever read.
- **A folder's results go into a new folder beside it**, `Holiday (JPEG)` for
  `Holiday` (then `Holiday (JPEG) 2`, never over an earlier one), with the
  subfolders mirrored inside and the names kept as `name.jpg`. The folder
  itself is left as it was, and a run on a parent folder passes over any
  `(JPEG)` results folder. The command line prints `Saved in <folder>`.
  The results folder is complete: a photo already in the output format (a
  JPEG when writing JPEG) is copied in as it is, with `"copied": true` on its
  `result` line, so the folder is ready to send as one.
- **`--beside`** saves each result beside its original instead of in the new
  folder (the app's "Save next to the originals instead").
- **`-o <dir>`** writes into that folder instead, a folder's own subfolders
  mirrored inside it. It wins over both of the above.
- **`-f jpeg|png`**, default JPEG. PNG is lossless and much bigger; use it only
  when asked or when the picture needs to stay exact, or has see-through parts:
  JPEG has none, so those turn white. A PNG carries no photo details.
- **`-q 40-100`**, JPEG quality, default 85 (what the app uses). Leave it
  unless asked.
- **`-s <pixels>`** shrinks so the long edge is at most that; 0, the default,
  keeps the size. 2000 is plenty for sharing.
- **`--strip`** drops the metadata, including the location. Offer it when the
  photos are going somewhere public.
- **`--best`** keeps full colour resolution, slower, for photos the user cares
  about keeping.
- **`--overwrite`** replaces a file already there with the same name instead of
  adding `name 2.jpg`, but only if that file was made by Just JPEG (every picture
  it writes carries a small mark, a JPEG comment or PNG text reading `Just JPEG`).
  A real photo with that name is kept and the result gets `name 2.jpg`, and so
  does an original or a file among the ones being converted.
- **`--dry-run`** lists what would be written and writes nothing. Use it on a
  big folder first and say how many files it found.

## Read the result

With `--json`, stdout is one JSON line per file: a `result` line (`input`,
`output`, `width`, `height`, `bytes`), a `skip`, or an `error` naming the file;
then a `done` line with the counts.

A `skip` line has a `reason`:

- `earlier-output`: the file looks like a result of an earlier run, so it was
  left alone (`from` names the photo it seems to come from). That means a file
  in the output format beside a photo of the same name in another format
  (`photo.jpg` by `photo.heic`), or that name with ` 2`, ` 3` after it. It only
  applies when saving beside the originals. A real edited `IMG_0001.JPG` kept
  next to `IMG_0001.HEIC` looks the same and is skipped too, with exit 0 and a
  line on stderr: if the user wants it converted, name it on its own.
- `original`: the result would land on the original itself (a JPEG to JPEG
  with `--overwrite`), so it was left alone.
- `output-exists`: the name is taken.

Exit codes: 0 done (everything converted, or skipped on purpose); 3 partly
done, some files failed (the `error` lines say which); 2 a usage mistake,
nothing started; 1 failed, nothing converted; 129, 130 or 143 stopped by a
signal, with no half-written file left.

## Report back

Say how many converted, where they went (the `Saved in` folder), and name any that failed and why. If
the user asked to shrink or strip, confirm it was done. Nothing is uploaded by
Just JPEG; don't send or upload the results yourself unless the user asks.
