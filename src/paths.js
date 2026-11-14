// Deciding where each converted file goes.
//
// Pure functions with the filesystem passed in, so the rules that protect
// people's originals can be tested directly rather than trusted by eye.

import path from 'node:path';

export function outputPathFor(sourcePath, outDir, format) {
  const ext = format === 'png' ? '.png' : '.jpg';
  const base = path.basename(sourcePath, path.extname(sourcePath));
  const dir = outDir || path.dirname(sourcePath);
  return path.join(dir, base + ext);
}

/**
 * True when two paths point at the same file. macOS and Windows are normally
 * case insensitive, so `IMG.JPG` and `img.jpg` are the same file there.
 */
export function isSameFile(a, b, platform = process.platform) {
  return pathKey(a, platform) === pathKey(b, platform);
}

/** The form isSameFile compares, for keeping a set of paths. */
export function pathKey(p, platform = process.platform) {
  return platform === 'linux' ? path.resolve(p) : path.resolve(p).toLowerCase();
}

/** ` 2`, ` 3` and so on, until the name is free. */
export function uniquePath(target, exists) {
  const dir = path.dirname(target);
  const ext = path.extname(target);
  const base = path.basename(target, ext);
  for (let n = 2; n < 10000; n++) {
    const candidate = path.join(dir, `${base} ${n}${ext}`);
    if (!exists(candidate)) return candidate;
  }
  // Refuse rather than fall back to the original name, which would overwrite
  // a file the user asked us to keep.
  throw new Error('Too many files with this name already exist');
}

/**
 * Work out the destination for one file.
 *
 * `exists` answers whether a path is already taken. Returns the chosen path
 * and whether to `write` or `skip`; a skip also says why (`reason`), so the
 * person can be told which setting would convert it after all.
 */
export function planOutput({ sourcePath, outDir, format, onExisting }, exists, platform, taken = () => false) {
  const target = outputPathFor(sourcePath, outDir, format);

  // Converting a JPEG to a JPEG in place resolves the output onto the original.
  // Never write over the file we are reading, whatever the setting says: the
  // original is the one thing that cannot be recreated.
  if (isSameFile(target, sourcePath, platform)) {
    return onExisting === 'rename'
      ? { path: uniquePath(target, (p) => taken(p) || exists(p)), action: 'write' }
      : { path: target, action: 'skip', reason: 'original' };
  }

  // `taken` names paths this run must never replace, even when asked to
  // overwrite: the other originals in the batch (IMG_0001.HEIC beside
  // IMG_0001.JPG) and outputs already claimed by a sibling with the same stem
  // (photo.heic and photo.tiff), which may not be on disk yet.
  const busy = (p) => taken(p) || exists(p);
  if (!busy(target)) return { path: target, action: 'write' };
  if (onExisting === 'skip') return { path: target, action: 'skip', reason: 'exists' };
  if (onExisting === 'rename' || taken(target)) return { path: uniquePath(target, busy), action: 'write' };
  return { path: target, action: 'write' };   // overwrite, as asked
}
