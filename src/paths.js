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
  const normalise = (p) => (platform === 'linux' ? path.resolve(p) : path.resolve(p).toLowerCase());
  return normalise(a) === normalise(b);
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
 * and whether to `write` or `skip`.
 */
export function planOutput({ sourcePath, outDir, format, onExisting }, exists, platform) {
  const target = outputPathFor(sourcePath, outDir, format);

  // Converting a JPEG to a JPEG in place resolves the output onto the original.
  // Never write over the file we are reading, whatever the setting says: the
  // original is the one thing that cannot be recreated.
  if (isSameFile(target, sourcePath, platform)) {
    return onExisting === 'rename'
      ? { path: uniquePath(target, exists), action: 'write' }
      : { path: target, action: 'skip' };
  }

  if (!exists(target)) return { path: target, action: 'write' };
  if (onExisting === 'skip') return { path: target, action: 'skip' };
  if (onExisting === 'rename') return { path: uniquePath(target, exists), action: 'write' };
  return { path: target, action: 'write' };   // overwrite, as asked
}
