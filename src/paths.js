// Deciding where each converted file goes.
//
// The rules themselves live in engine.js, which has no node imports so the
// window and the command line can share it; this binds them to this machine's
// `path` and adds the one rule that has to read a file (is it one Just JPEG made).

import fs from 'node:fs';
import path from 'node:path';
import { hasMark } from './mark.js';
import { pathRules } from './engine.js';

export const {
  pathKey, isSameFile, outputPathFor, isInOutputFormat, uniquePath, planOutput,
} = pathRules(path, process.platform);

/** True when the file at `file` is one Just JPEG wrote (it carries the mark). Reads only its headers. A file that cannot be read is not ours. */
export function isOurs(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    return hasMark((pos, len) => {
      const buf = Buffer.alloc(len);
      const n = fs.readSync(fd, buf, 0, len, pos);
      return buf.subarray(0, n);
    });
  } catch {
    return false;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* fine */ }
  }
}
