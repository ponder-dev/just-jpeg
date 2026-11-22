// Just JPEG's engine: every decision, once.
//
// The window and the command line both convert photos, and for a long time each
// decided for itself what a setting meant, which files counted, where a result
// went, what was skipped, how a picture was turned and sized, what travelled
// into the file and what a failure said. Two copies drift. This is the one
// copy. The window's main process, the conversion worker and cli.mjs call it
// and keep only what cannot be shared:
//
//   pixels   the worker draws on a canvas, cli.mjs uses src/pixels.js and
//            @jsquash/resize on raw buffers (and neither can do camera RAW in
//            the other's place: RAW is the app's alone)
//   I/O      reading and writing files, IPC, the terminal
//
// Plain ES module for the worker and for node alike: no DOM, and no node
// imports of its own. What needs `path` or the disk is handed in (createBatchPlanner,
// pathRules); what needs a decoder library is handed that library (decodeHeif,
// decodeTiff). Tested by test/engine.test.mjs.

import { sniff } from './sniff.js';
import { markFor } from './mark.js';
import {
  extractExif, readOrientation, setOrientation, setPixelSize, tiffPageInfo, finalizeJpeg, heifHasTransform, iccFromHeif,
} from './exif.js';

export { sniff, extractExif };

/* --- settings ----------------------------------------------------------- */

/** What the slider, the size menu and the flags start at. */
export const DEFAULTS = { format: 'jpeg', quality: 85, size: 0 };
export const QUALITY_RANGE = [40, 100];

/** Words for whatever is wrong with a setting, or null. The flag names are the command line's. */
export function settingsProblem({ format, quality, size }) {
  if (!['jpeg', 'png'].includes(format)) return `--format is jpeg or png, not "${format}"`;
  if (!(quality >= QUALITY_RANGE[0] && quality <= QUALITY_RANGE[1])) return `--quality is ${QUALITY_RANGE[0]} to ${QUALITY_RANGE[1]}`;
  // A negative size used to shrink every image to 1x1, and a word was ignored.
  if (!(Number.isInteger(size) && size >= 0)) return '--size is a whole number of pixels';
  return null;
}

/* --- which files count -------------------------------------------------- */

const HEIF_EXTS = ['.heic', '.heif', '.avci', '.avif', '.hif'];
const RAW_EXTS = [
  '.dng', '.cr2', '.cr3', '.crw', '.nef', '.nrw', '.arw', '.srf', '.sr2',
  '.raf', '.orf', '.rw2', '.raw', '.pef', '.ptx', '.srw', '.kdc', '.dcr',
  '.mrw', '.3fr', '.mef', '.mos', '.erf', '.x3f', '.iiq',
];
const PLAIN_EXTS = ['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp'];
// Pictures the window reads with the browser's own decoder; the command line has none.
const APP_ONLY_EXTS = ['.bmp', '.gif'];

/**
 * The extensions a folder scan picks up. The command line scans RAW too, only
 * so it can say it left them for the app; GIF and BMP it cannot read at all.
 */
export function extensionsFor(backend) {
  return [...HEIF_EXTS, ...RAW_EXTS, ...PLAIN_EXTS, ...(backend === 'app' ? APP_ONLY_EXTS : [])];
}

export function isRawExtension(ext) {
  return RAW_EXTS.includes(ext.toLowerCase());
}

/**
 * Whether a file the sniff called 'raw' (TIFF-shaped) is a camera RAW, and
 * not an ordinary TIFF. It decides what happens when LibRaw fails: an ordinary
 * TIFF goes on to the TIFF reader, but a camera RAW fails there and then. A
 * damaged or cut-short RAW still holds its small embedded preview, which the
 * TIFF reader would hand back as if it were the photo (decided 2026-11-21).
 *
 * A camera RAW by its name (a RAW extension) or by its bytes: a container that
 * is not TIFF at all (CR3, RAF), a maker's own TIFF magic (ORF, RW2), Canon's
 * CR2 mark, or a DNGVersion tag in the first directory.
 */
export function isCameraRaw(bytes, name = '') {
  const dot = name.lastIndexOf('.');
  if (dot > -1 && isRawExtension(name.slice(dot))) return true;
  const b = bytes;
  if (!b || b.length < 16) return false;
  const le = b[0] === 0x49 && b[1] === 0x49;
  const be = b[0] === 0x4d && b[1] === 0x4d;
  if (!le && !be) return true;                                         // CR3, RAF: not TIFF at all
  const u16 = (o) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
  const u32 = (o) => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
    : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
  if (u16(2) !== 42) return true;                                      // ORF (RO, RS), RW2 (0x55)
  if (b[8] === 0x43 && b[9] === 0x52) return true;                     // CR2
  const ifd = u32(4);
  if (ifd < 8 || ifd + 2 > b.length) return false;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const at = ifd + 2 + i * 12;
    if (at + 2 > b.length) break;
    if (u16(at) === 0xc612) return true;                               // DNGVersion
  }
  return false;
}

/* --- the words ---------------------------------------------------------- */

export const MESSAGES = {
  unknown: 'Not an image file we recognize',
  noHeif: 'No image found inside this HEIC file',
  heifEmpty: 'HEIC reports a zero-sized image',
  heifFailed: 'HEIC decode failed',
  tiffNone: 'No image found inside this TIFF',
  tiffEmpty: 'TIFF reports a zero-sized image',
  rawDamaged: 'This RAW file is damaged or incomplete, so it was not converted',
};

/** A failure with the file's name in front ("a.heic: not an image file we recognize"). */
export function labelled(label, message) {
  return `${label}: ${message.charAt(0).toLowerCase()}${message.slice(1)}`;
}

/* --- decoding, with the library each side brings ------------------------ */

/** The first picture in a HEIC, as { width, height, data } RGBA. `lib` is libheif-js. */
export async function decodeHeif(lib, bytes) {
  const images = new lib.HeifDecoder().decode(bytes);
  if (!images || !images.length) throw new Error(MESSAGES.noHeif);

  const img = images[0];
  const width = img.get_width();
  const height = img.get_height();
  if (!width || !height) throw new Error(MESSAGES.heifEmpty);

  const out = { width, height, data: new Uint8ClampedArray(width * height * 4) };
  await new Promise((resolve, reject) => {
    img.display(out, (result) => (result ? resolve(result) : reject(new Error(MESSAGES.heifFailed))));
  });
  // Some builds hold native memory until told otherwise.
  try { img.free && img.free(); } catch { /* not fatal */ }
  return out;
}

/**
 * The first page of a plain TIFF (scanners, exports; not RAW) as
 * { image: { width, height, data }, orientation, icc }. A TIFF says in its own
 * tags how it is turned and what colours it holds; decoding does neither for
 * us. `UTIF` is the utif library.
 */
export function decodeTiff(UTIF, bytes) {
  const ifds = UTIF.decode(bytes);
  if (!ifds || !ifds.length) throw new Error(MESSAGES.tiffNone);
  const page = ifds[0];
  UTIF.decodeImage(bytes, page, ifds);
  const rgba = UTIF.toRGBA8(page);
  if (!page.width || !page.height) throw new Error(MESSAGES.tiffEmpty);
  return {
    image: { data: new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), width: page.width, height: page.height },
    ...tiffPageInfo(page),
  };
}

/* --- turning, size, what travels ---------------------------------------- */

export function swapsAxes(orientation) {
  return orientation >= 5 && orientation <= 8;
}

/**
 * The orientation still ours to apply to the decoded pixels (1 means they are
 * already upright).
 *   heif    libheif applies the container's own rotation while decoding; only a
 *           file with none still needs its EXIF orientation applied
 *   native  the browser honours EXIF itself, so in the window nothing is left to
 *           do; the command line has no browser and reads it
 *   raw     libraw applies the camera's flip, so nothing is left; but a plain
 *           TIFF (the fallback) comes back as stored and its own turn (tiffTurn)
 *           is ours
 * Rotating twice would tip the photo on its side.
 */
export function orientationFor({ kind, backend, tiff = null, bytes = null, heifTransform = bytes ? heifHasTransform(bytes) : false, tiffTurn = 1 }) {
  let orientation = 1;
  if (kind === 'heif' && !heifTransform) orientation = tiff ? readOrientation(tiff) : 1;
  if (kind === 'native' && backend === 'cli') orientation = tiff ? readOrientation(tiff) : 1;
  if (tiffTurn !== 1) orientation = tiffTurn;
  return orientation;
}

/** The factor a picture is shrunk by once turned so its long edge is at most `maxDim` (0 keeps it); never above 1. */
export function fitScale(srcW, srcH, orientation = 1, maxDim = 0) {
  const w = swapsAxes(orientation) ? srcH : srcW;
  const h = swapsAxes(orientation) ? srcW : srcH;
  return maxDim && Math.max(w, h) > maxDim ? maxDim / Math.max(w, h) : 1;
}

/** The size a picture comes out at, turned and shrunk: both the canvas and the raw buffers need exactly this. */
export function fitSize(srcW, srcH, orientation = 1, maxDim = 0) {
  const scale = fitScale(srcW, srcH, orientation, maxDim);
  const w = swapsAxes(orientation) ? srcH : srcW;
  const h = swapsAxes(orientation) ? srcW : srcH;
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** JPEG has no see-through: what a transparent pixel is painted over. */
export const BACKGROUND = '#ffffff';

/**
 * mozjpeg's settings. The canvas encoder always writes 4:2:0, which throws away
 * half the colour resolution; "highest quality" (--best) writes 4:4:4 instead.
 */
export function jpegOptions({ quality, best }) {
  return {
    quality,
    ...(best ? { auto_subsample: false, chroma_subsample: 1 } : {}),
    progressive: true,
    optimize_coding: true,
  };
}

/** Which colour profile has to be carried by hand: only HEIF and plain TIFF need it. Others are converted on decode, and libraw outputs sRGB. */
export function profileFor({ kind, bytes, tiffIcc = null }) {
  return kind === 'heif' ? iccFromHeif(bytes) : tiffIcc;
}

/**
 * The finished file: for JPEG, photo details (the EXIF with the turn set to
 * "already upright" and the new pixel size) when kept, and the colour profile;
 * then Just JPEG's mark on every picture. PNG carries no EXIF.
 */
export function finishOutput({ format, bytes, tiff, icc, keepMetadata, width, height }) {
  let out = bytes;
  if (format !== 'png') {
    out = finalizeJpeg(out, {
      exif: keepMetadata && tiff ? setPixelSize(setOrientation(tiff, 1), width, height) : null,
      icc,
    });
  }
  return markFor(format, out);
}

/* --- where each result goes --------------------------------------------- */

/**
 * The rules for names and paths, over the `path` module of the platform they
 * run on (so tests can use win32). Pure functions with the filesystem passed
 * in, so the rules that protect people's originals can be tested directly.
 */
export function pathRules(path, defaultPlatform = 'linux') {
  /** The form two paths are compared in. macOS and Windows are normally case insensitive. */
  function pathKey(p, platform = defaultPlatform) {
    return platform === 'linux' ? path.resolve(p) : path.resolve(p).toLowerCase();
  }
  function isSameFile(a, b, platform = defaultPlatform) {
    return pathKey(a, platform) === pathKey(b, platform);
  }

  function outputPathFor(sourcePath, outDir, format) {
    const ext = format === 'png' ? '.png' : '.jpg';
    const base = path.basename(sourcePath, path.extname(sourcePath));
    const dir = outDir || path.dirname(sourcePath);
    return path.join(dir, base + ext);
  }

  /**
   * True when a photo is already in the format being written. Beside its
   * original such a photo is left alone; in a folder's results folder it is
   * copied in as it is, so the results folder is complete. With the file's
   * first bytes: a file merely named .jpg that is no JPEG is not "already
   * fine", it goes the normal way and is reported unreadable.
   */
  function isInOutputFormat(sourcePath, format, head) {
    if (head && !(format === 'png' ? head[0] === 0x89 && head[1] === 0x50 : head[0] === 0xff && head[1] === 0xd8)) return false;
    const ext = path.extname(sourcePath).toLowerCase();
    return format === 'png' ? ext === '.png' : ext === '.jpg' || ext === '.jpeg';
  }

  /** ` 2`, ` 3` and so on, until the name is free. */
  function uniquePath(target, exists) {
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
   * Work out the destination for one file. `exists` answers whether a path is
   * already taken. Returns the chosen path and whether to `write` or `skip`; a
   * skip also says why (`reason`).
   *
   * `taken(path)` names paths this run must never replace, even when asked to
   * overwrite: the other originals in the batch and outputs already claimed.
   * `ours(path)` says whether a file there carries Just JPEG's own mark.
   * Replacing only ever replaces such a file.
   */
  function planOutput({ sourcePath, outDir, format, onExisting }, exists, platform = defaultPlatform, taken = () => false, ours = () => false) {
    const target = outputPathFor(sourcePath, outDir, format);

    // Converting a JPEG to a JPEG in place resolves the output onto the original.
    // Never write over the file we are reading, whatever the setting says.
    if (isSameFile(target, sourcePath, platform)) {
      return onExisting === 'rename'
        ? { path: uniquePath(target, (p) => taken(p) || exists(p)), action: 'write' }
        : { path: target, action: 'skip', reason: 'original' };
    }

    const busy = (p) => taken(p) || exists(p);
    if (!busy(target)) return { path: target, action: 'write' };
    if (onExisting === 'skip') return { path: target, action: 'skip', reason: 'exists' };
    if (onExisting === 'rename' || taken(target)) return { path: uniquePath(target, busy), action: 'write' };
    if (onExisting === 'overwrite' && !ours(target)) return { path: uniquePath(target, busy), action: 'write' };
    return { path: target, action: 'write' };   // overwrite our own earlier file, as asked
  }

  return { pathKey, isSameFile, outputPathFor, isInOutputFormat, uniquePath, planOutput };
}

/**
 * The plan for one batch, the same for the window and the command line.
 *
 *   files     [{ path, from }]: every original in the run; `from` is the folder
 *             it was found in (null for a file named on its own)
 *   settings  { format, onExisting, outDir, beside }
 *   kit       the kit's { resultsFolder, resultDir }
 *   exists / ours   the disk, passed in
 *
 * plan(file, readHead) answers, for one file, { action: 'write' | 'skip', path,
 * folder, copy, reason, from, unreadable }. `readHead()` gives the file's first
 * bytes (or a promise of them), asked for only when the answer needs them.
 *
 * Decided here, once:
 *  - a chosen folder wins and mirrors a folder's subfolders; otherwise a
 *    folder's results go in a new "Holiday (JPEG)" beside it, chosen once per
 *    folder per run; or beside the original (--beside, or a file on its own)
 *  - a photo that looks like this tool's own earlier result (photo.jpg beside
 *    photo.heic, or photo 2.jpg, photo 2 2.jpg) is left alone, but only where
 *    results land beside the originals. A name rule, so an edited IMG_0001.JPG
 *    kept beside IMG_0001.HEIC is taken for a result too: name it on its own
 *  - the originals of the run and every name already claimed are never replaced
 *  - in a results folder a photo already in the output format is copied in
 *  - a skipped file that is no image at all is flagged unreadable
 */
export function createBatchPlanner({ path, platform, files, settings, kit, exists, ours = () => false }) {
  const rules = pathRules(path, platform);
  const { pathKey } = rules;
  const { format, onExisting, outDir, beside } = settings;

  const fromOf = new Map(files.map((f) => [pathKey(f.path), f.from || null]));
  // Paths this run must not replace: every original in it, and every output
  // already claimed, so replacing only ever replaces older output.
  const taken = new Set(files.map((f) => pathKey(f.path)));
  const resultsFor = new Map();
  const resultsFolders = new Set();

  function earlierOutputs() {
    const map = new Map();
    if (outDir) return map;
    const outExts = format === 'png' ? ['.png'] : ['.jpg', '.jpeg'];
    const stem = (f) => pathKey(path.join(path.dirname(f), path.basename(f, path.extname(f))));
    const sources = new Map();
    for (const { path: f } of files) {
      if (!outExts.includes(path.extname(f).toLowerCase()) && !sources.has(stem(f))) sources.set(stem(f), f);
    }
    for (const { path: f } of files) {
      if (!outExts.includes(path.extname(f).toLowerCase())) continue;
      // The exact name first, then with trailing " 2", " 3" taken off, one at a
      // time, so a copy of a copy is found too.
      let key = stem(f);
      while (!sources.has(key) && /^.* \d+$/.test(key)) key = key.replace(/ \d+$/, '');
      if (sources.has(key)) map.set(pathKey(f), sources.get(key));
    }
    return map;
  }
  const earlier = earlierOutputs();

  function placeOf(file) {
    const from = fromOf.get(pathKey(file)) || null;
    const f = { path: path.resolve(file), from };
    if (outDir) return { dir: from ? kit.resultDir(f, path.resolve(outDir)) : outDir, folder: null };
    if (!from || beside) return { dir: path.dirname(f.path), folder: null };
    if (!resultsFor.has(from)) {
      const into = kit.resultsFolder(from, 'JPEG', exists);
      resultsFor.set(from, into);
      resultsFolders.add(into);
    }
    const into = resultsFor.get(from);
    return { dir: kit.resultDir(f, into), folder: into };
  }

  async function plan(file, readHead = () => null) {
    const where = placeOf(file);
    const from = where.folder ? null : earlier.get(pathKey(file));
    if (from) return { action: 'skip', reason: 'earlier-output', path: null, from, folder: null, copy: false, unreadable: false };

    const result = rules.planOutput(
      { sourcePath: file, outDir: where.dir, format, onExisting },
      exists,
      platform,
      (p) => taken.has(pathKey(p)),
      ours,
    );
    if (result.action === 'write') taken.add(pathKey(result.path));
    result.folder = where.folder;
    result.copy = false;
    result.unreadable = false;
    // In a results folder a photo already in the output format is copied in as
    // it is; beside the original it is left alone, as ever.
    if (result.action === 'write' && where.folder && rules.isInOutputFormat(file, format, await readHead())) result.copy = true;
    // A skipped file is never decoded, so a damaged one (or a .jpg that isn't
    // an image at all) would read as a plain skip. Its first bytes say so.
    if (result.action === 'skip') result.unreadable = sniff((await readHead()) || new Uint8Array(0)) === 'unknown';
    return result;
  }

  return { plan, resultsFolders, rules };
}

/* --- saying a skip ------------------------------------------------------- */

const base = (path, sep = /[\\/]/) => String(path).split(sep).pop();

/** Why a file was skipped, in the window's voice or the command line's. */
export function skipText(plan, voice) {
  if (plan.reason === 'earlier-output') return `looks like the conversion of ${base(plan.from)}, so it was left alone`;
  const name = base(plan.path);
  if (plan.reason === 'original') return voice === 'app' ? `saving ${name} here would replace the original` : 'it would replace the original';
  return `${name} is already there`;
}

/** The name a skip goes by in --json (the planner calls a taken name "exists"). */
export function skipCode(plan) {
  return plan.reason === 'exists' ? 'output-exists' : plan.reason;
}

/* --- writing ------------------------------------------------------------- */

/**
 * Results are written under this name beside the target and renamed into
 * place, so a run stopped mid-write never leaves half an image, least of all
 * over a good one that replacing was replacing.
 */
export function tempPath(target, unique) {
  return `${target}.justjpeg-${unique}.tmp`;
}
