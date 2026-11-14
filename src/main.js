// Main process: owns the filesystem, the window, and nothing else.
// All image work happens in renderer workers.

import { app, BrowserWindow, dialog, ipcMain, shell, Menu, screen } from 'electron';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { planOutput, isSameFile, pathKey } from './paths.js';
import { sniff } from './sniff.js';

// This file is always bundled to CommonJS, so __dirname is the app directory.
const APP_DIR = __dirname;

// Extensions we will pick up when scanning a folder. Sniffing still has the
// final say once a file is opened; this is just to avoid reading every file
// on disk to find out it was a .txt.
const INPUT_EXTENSIONS = new Set([
  // Apple / HEIF
  '.heic', '.heif', '.avci', '.avif', '.hif',
  // Camera RAW
  '.dng', '.cr2', '.cr3', '.crw', '.nef', '.nrw', '.arw', '.srf', '.sr2',
  '.raf', '.orf', '.rw2', '.raw', '.pef', '.ptx', '.srw', '.kdc', '.dcr',
  '.mrw', '.3fr', '.mef', '.mos', '.erf', '.x3f', '.iiq',
  // Ordinary formats, so the tool is useful for plain conversions too
  '.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp', '.bmp', '.gif',
]);

let mainWindow = null;

// The folder of the last file chosen, from a dialog or a drop. Windows starts
// an Open window in Downloads otherwise, which is usually empty.
let lastOpenDir = null;

// ------------------------------------------------------------------ window ---

// A small laptop screen, or a 1366x768 one with its taskbar, has less height
// than a window may ask for, and the bottom of the window, its main button
// included, then sat out of reach. The window and its minimum are fitted to
// the work area of the screen it opens on.
function fitToScreen(opts) {
  const area = screen.getPrimaryDisplay().workAreaSize;
  const fit = { ...opts };
  for (const [key, side] of [['width', 'width'], ['height', 'height'], ['minWidth', 'width'], ['minHeight', 'height']]) {
    if (typeof fit[key] === 'number') fit[key] = Math.min(fit[key], area[side]);
  }
  return fit;
}

function createWindow() {
  mainWindow = new BrowserWindow(fitToScreen({
    width: 940,
    height: 720,
    minWidth: 720,
    minHeight: 560,
    title: 'Just JPEG',
    backgroundColor: '#12131a',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
    webPreferences: {
      preload: path.join(APP_DIR, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  }));

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(APP_DIR, 'renderer', 'index.html'));

  // Open external links in the real browser, never in the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

let licenseWindow = null;

// Just JPEG bundles LGPL libraries, so the credits are not decoration: the
// licences have to be readable from inside the app.
function openLicenses() {
  if (licenseWindow && !licenseWindow.isDestroyed()) {
    licenseWindow.focus();
    return;
  }
  licenseWindow = new BrowserWindow({
    width: 760,
    height: 680,
    title: 'Licences and credits',
    backgroundColor: '#12131a',
    parent: mainWindow || undefined,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  licenseWindow.setMenuBarVisibility(false);
  licenseWindow.loadFile(path.join(APP_DIR, 'renderer', 'licenses.html'));
  licenseWindow.on('closed', () => { licenseWindow = null; });
}

// A deliberately small menu. Edit is kept so copy/paste and the standard
// shortcuts behave on macOS.
function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Licences and credits', click: openLicenses },
        { type: 'separator' },
        { label: 'Just JPEG on the web', click: () => shell.openExternal('https://ponderdev.com/justjpeg') },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ------------------------------------------------------------------ scanning ---

async function scanPaths(inputPaths) {
  const found = [];
  const seen = new Set();

  async function walk(target) {
    let stat;
    try { stat = await fs.stat(target); } catch { return; }

    if (stat.isDirectory()) {
      let entries;
      try { entries = await fs.readdir(target, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        // Skip macOS bundles and hidden folders; nothing useful in there.
        if (entry.name.startsWith('.')) continue;
        await walk(path.join(target, entry.name));
      }
      return;
    }

    if (!stat.isFile()) return;
    if (!INPUT_EXTENSIONS.has(path.extname(target).toLowerCase())) return;
    // AppleDouble sidecars look like real images by extension.
    if (path.basename(target).startsWith('._')) return;
    if (seen.has(target)) return;

    seen.add(target);
    found.push({ path: target, name: path.basename(target), size: stat.size });
  }

  for (const p of inputPaths) await walk(p);
  found.sort((a, b) => a.path.localeCompare(b.path));
  return found;
}

// ------------------------------------------------------------------ writing ---

// ---------------------------------------------------------------------- IPC ---

ipcMain.handle('app:info', () => ({
  platform: process.platform,
  version: app.getVersion(),
  cores: Math.max(1, os.cpus().length),
}));

ipcMain.handle('dialog:pickInput', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose photos or folders',
    defaultPath: lastOpenDir || app.getPath('documents'),
    // On Windows and Linux one Open window cannot pick files and folders at
    // once: asked for both, it shows a folder picker, and single files can't
    // be chosen at all. There it picks files (folders still come in by
    // dropping); on a Mac it can do both, so it still does.
    properties: process.platform === 'darwin'
      ? ['openFile', 'openDirectory', 'multiSelections']
      : ['openFile', 'multiSelections'],
  });
  if (result.canceled) return [];
  lastOpenDir = path.dirname(result.filePaths[0]);
  return result.filePaths;
});

ipcMain.handle('dialog:pickOutput', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose where to save',
    defaultPath: lastOpenDir || app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('fs:scan', (_e, inputPaths) => {
  // Dropped paths come in only here, so this is where a drop is remembered.
  if (inputPaths && inputPaths.length) lastOpenDir = path.dirname(path.resolve(inputPaths[0]));
  return scanPaths(inputPaths);
});

ipcMain.handle('fs:read', async (_e, filePath) => {
  const buf = await fs.readFile(filePath);
  // Hand over the bytes without copying them again on the way out.
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});

// Paths the current run must not replace: its originals, and outputs already
// planned. Workers plan in parallel before anything is written, so without
// this two photos with one stem (photo.heic, photo.tiff) were both given
// photo.jpg, and "Replace it" could replace IMG_0001.JPG with IMG_0001.HEIC.
// Plans are claimed here, in one process, so two can never collide.
let taken = new Set();

ipcMain.handle('fs:startRun', (_e, sourcePaths) => {
  taken = new Set((sourcePaths || []).map((p) => pathKey(p)));
});

ipcMain.handle('fs:plan', async (_e, options) => {
  const plan = planOutput(options, (p) => fsSync.existsSync(p), process.platform, (p) => taken.has(pathKey(p)));
  if (plan.action === 'write') taken.add(pathKey(plan.path));
  // A skipped file is never decoded, so a damaged one (or a .jpg that isn't an
  // image at all) was reported as a plain skip. Its first bytes are enough to
  // say it couldn't be read instead.
  if (plan.action === 'skip') plan.unreadable = sniff(await readHead(options.sourcePath)) === 'unknown';
  return plan;
});

async function readHead(filePath) {
  let handle;
  try {
    handle = await fs.open(filePath, 'r');
    const buf = Buffer.alloc(64);
    const { bytesRead } = await handle.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead);
  } catch {
    return Buffer.alloc(0);
  } finally {
    if (handle) await handle.close();
  }
}

ipcMain.handle('fs:write', async (_e, { targetPath, bytes, sourcePath, keepDate }) => {
  // The planner already refuses this, but the rule is important enough to
  // enforce at the point of writing too. Nothing should be able to reach this
  // handler with a target that would destroy the source.
  if (isSameFile(targetPath, sourcePath)) {
    throw new Error('Refusing to write over the original file');
  }

  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  // Write beside the target then rename, so an interrupted run never leaves a
  // half-written image where a good one should be. The random suffix keeps two
  // workers from picking the same temp name in the same millisecond.
  const unique = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const temp = `${targetPath}.justjpeg-${unique}.tmp`;
  try {
    await fs.writeFile(temp, Buffer.from(bytes));
    await fs.rename(temp, targetPath);
  } catch (err) {
    try { await fs.unlink(temp); } catch { /* nothing to clean up */ }
    throw err;
  }

  if (keepDate) {
    try {
      const stat = await fs.stat(sourcePath);
      await fs.utimes(targetPath, stat.atime, stat.mtime);
    } catch { /* the image is written; the timestamp is a nicety */ }
  }
  return true;
});

ipcMain.handle('app:licenses', () => openLicenses());

ipcMain.handle('shell:reveal', (_e, target) => {
  shell.showItemInFolder(target);
});

ipcMain.handle('shell:openExternal', (_e, url) => {
  if (/^https:\/\//.test(url)) shell.openExternal(url);
});

// ----------------------------------------------------------------- lifecycle ---

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    buildMenu();
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
