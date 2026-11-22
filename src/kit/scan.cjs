/* PonderDev kit 1.0.0, built from kit/src. Do not edit: run bin/kit-sync. */
'use strict';
/*
 * The family's intake for several files or a folder (decided 2026-11-20:
 * every tool takes a dropped folder, and several files). It runs on the main
 * side, and in a tool's command line, so a folder means the same thing in the
 * window and in a terminal, and in every tool.
 *
 *   const { scan } = require('./kit/scan.cjs');
 *   const { files, folders, missing } = await scan(paths, {
 *     extensions: ['.mp4', '.mov'],   // what a tool takes from inside a folder
 *     ours: /-fits( \d+)?$/i,          // its own results, passed over in a folder
 *     anyNamed: true,                  // a file named on its own is taken whatever its name
 *     word: 'fitted',                  // its results folders ("Holiday (fitted)"), passed over
 *   });
 *
 * files is [{ path, name, bytes, from }], resolved, each once, in the order a file
 * browser lists them (numbers counted, so "clip 2" comes before "clip 10").
 * folders counts the folders named; missing lists named paths that are not
 * there. Inside a folder, subfolders too, only names with one of the
 * extensions are taken, and hidden files and folders, the AppleDouble files
 * ("._name") a Mac leaves on other disks, and the tool's own results are
 * passed over, so a folder done once and then again is not done on top of
 * itself. A file named on its own is taken when anyNamed is set (the tool's
 * probe then says whether it can read it), or else only with one of the
 * extensions. from is the folder named that the file was found in, or null
 * for a file named on its own. It never throws: a folder it cannot read is
 * passed over.
 *
 * Where results go (decided 2026-11-20): a file named on its own gets its
 * result beside it, as always. A folder's results go into a new folder beside
 * it, named for what the tool did ("Holiday (fitted)", "Holiday (JPEG)"),
 * with the folder's subfolders mirrored inside and the folder itself left
 * untouched. A name that is taken gets " 2", then 3: nothing is written over.
 * A tool may offer "Save next to the originals instead", which puts every
 * result beside its own original.
 *
 *   const into = resultsFolder(file.from, 'fitted');   // once per folder, per run
 *   const dir = resultDir(file, into);                  // where this file's result goes
 */
const fs = require('node:fs');
const path = require('node:path');

async function scan(paths, options = {}) {
  const extensions = new Set((options.extensions || []).map((e) => e.toLowerCase()));
  const ours = options.ours || null;
  const anyNamed = options.anyNamed !== false;
  const resultsName = options.word ? new RegExp(` \\(${options.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)( \\d+)?$`, 'i') : null;
  const found = [];
  const seen = new Set();
  const missing = [];
  let folders = 0;

  async function walk(target, named, from) {
    let stat;
    try { stat = await fs.promises.stat(target); } catch { if (named) missing.push(target); return; }

    if (stat.isDirectory()) {
      if (named) folders++;
      else if (resultsName && resultsName.test(path.basename(target))) return;
      let entries;
      try { entries = await fs.promises.readdir(target, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        await walk(path.join(target, entry.name), false, named ? path.resolve(target) : from);
      }
      return;
    }

    if (!stat.isFile()) return;
    const ext = path.extname(target).toLowerCase();
    if (!(named && anyNamed) && !extensions.has(ext)) return;
    if (!named && path.basename(target).startsWith('._')) return;
    if (!named && ours && ours.test(path.parse(target).name)) return;
    const key = path.resolve(target);
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ path: key, name: path.basename(target), bytes: stat.size, from: named ? null : from });
  }

  for (const p of paths) await walk(p, true, null);
  found.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  return { files: found, folders, missing };
}

// A new folder beside the one named, for its results: "Holiday (fitted)", or
// "Holiday (fitted) 2" when that is taken (by anything: a file, a folder, an
// earlier run). Nothing is made here; the tool makes it when a result is ready.
function resultsFolder(folder, word, exists = fs.existsSync) {
  const base = `${path.resolve(folder)} (${word})`;
  let candidate = base;
  for (let n = 2; exists(candidate) && n < 1000; n++) candidate = `${base} ${n}`;
  return candidate;
}

// Where one file's result goes: beside it when it was named on its own or no
// results folder is given (Save next to the originals), or else at the same
// place inside the results folder as it sits inside its own folder.
function resultDir(file, into) {
  if (!file.from || !into) return path.dirname(file.path);
  return path.join(into, path.relative(file.from, path.dirname(file.path)));
}

module.exports = { scan, resultsFolder, resultDir };
module.exports.VERSION = '1.0.0';
