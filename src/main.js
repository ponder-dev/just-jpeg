// Main process: owns the filesystem, the window, and nothing else.
// All image work happens in renderer workers.

import { app, BrowserWindow, dialog, ipcMain, shell, Menu, screen } from 'electron';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isOurs } from './paths.js';
import { createBatchPlanner, extensionsFor, pathRules, tempPath } from './engine.js';
import * as kit from './kit/scan.cjs';
// The frame: a dark title bar of the app's own on Windows and Linux, the traffic lights on a Mac.
import { frame, dress } from './kit/window.cjs';
import { showWhenReady } from './show.js';

// This file is always bundled to CommonJS, so __dirname is the app directory.
const APP_DIR = __dirname;

// The tool's own version, from its package.json. Not app.getVersion(): run by
// a test or a harness, Electron reports its own version instead.
const APP_VERSION = (() => {
  try { return JSON.parse(fsSync.readFileSync(path.join(APP_DIR, '..', 'package.json'), 'utf8')).version; } catch (e) { return app.getVersion(); }
})();

// What a scan picks up, and every rule about where results go, is the engine's
// (src/engine.js), the same one the command line runs. Sniffing still has the
// final say once a file is opened; the extensions only avoid reading every file
// on disk to find out it was a .txt.
const SCANNED = new Set(extensionsFor('app'));
const { isSameFile } = pathRules(path, process.platform);

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
  // The utility width every one-step Just tool shares (the kit's
  // --utility-width); the settings scroll inside it, so it does not widen.
  mainWindow = new BrowserWindow(fitToScreen({
    width: 720,
    height: 820,
    minWidth: 560,
    minHeight: 560,
    title: 'Just JPEG',
    ...frame(),
    show: false,
    webPreferences: {
      preload: path.join(APP_DIR, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // The version, from package.json, for the start screen and the footer.
      // A sandboxed preload cannot read package.json, so it comes on argv.
      additionalArguments: ['--app-version=' + APP_VERSION],
      // Only the window test sets this: drawn off screen, never shown.
      offscreen: Boolean(process.env.JUSTJPEG_TEST_OFFSCREEN),
    },
  }));

  showWhenReady(mainWindow);
  dress(mainWindow);
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
    ...frame(),
    parent: mainWindow || undefined,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  dress(licenseWindow);
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

// What a folder holds comes from the kit's intake, the same for every Just tool
// and for the command line. A file named on its own must be a kind this tool
// takes (anyNamed: false); its own results folders ("Holiday (JPEG)") are passed
// over. Its results are named name.jpg with no suffix of its own to pass over.
async function scanPaths(inputPaths) {
  const found = await kit.scan(inputPaths, { extensions: [...SCANNED], anyNamed: false, word: 'JPEG' });
  return found.files.map((f) => ({ path: f.path, name: f.name, size: f.bytes, from: f.from }));
}

// The folder each scanned file came in with (null for a file named on its own).
// Main's own record: the page never says which folder a file belongs to.
const cameFrom = new Map();

// This run's plan, made when the run starts (the engine's batch planner: where
// every result goes, what is left alone, what is never replaced). It holds the
// results folders it handed out, so only those are ever tidied up.
let planner = null;

// A results folder left empty (a save failed) goes again, up to the folder itself.
function tidy(dir, folder) {
  if (!folder || !planner || !planner.resultsFolders.has(folder)) return;
  for (let d = dir; d.startsWith(folder); d = path.dirname(d)) {
    try { fsSync.rmdirSync(d); } catch { break; }
    if (d === folder) break;
  }
}

// ------------------------------------------------------------------ writing ---

// ---------------------------------------------------------------------- IPC ---

ipcMain.handle('app:info', () => ({
  platform: process.platform,
  version: APP_VERSION,
  cores: Math.max(1, os.cpus().length),
}));

ipcMain.handle('dialog:pickInput', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: process.platform === 'darwin' ? 'Choose photos or folders' : 'Choose photos',
    defaultPath: lastOpenDir || app.getPath('documents'),
    // On Windows and Linux one Open window cannot pick files and folders at
    // once: asked for both, it shows a folder picker, and single files can't
    // be chosen at all. There it picks files and the start screen's Choose a
    // folder (dialog:pickFolder) brings a folder in; on a Mac one window does both.
    properties: process.platform === 'darwin'
      ? ['openFile', 'openDirectory', 'multiSelections']
      : ['openFile', 'multiSelections'],
  });
  if (result.canceled) return [];
  lastOpenDir = path.dirname(result.filePaths[0]);
  return result.filePaths;
});

// Folders alone, for Windows and Linux, where pickInput cannot offer them.
ipcMain.handle('dialog:pickFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a folder of photos',
    defaultPath: lastOpenDir || app.getPath('documents'),
    properties: ['openDirectory', 'multiSelections'],
  });
  if (result.canceled || !result.filePaths.length) return [];
  lastOpenDir = result.filePaths[0];
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
  return scanPaths(inputPaths).then((files) => {
    cameFrom.clear();
    for (const f of files) cameFrom.set(f.path, f.from);
    return files;
  });
});

ipcMain.handle('fs:read', async (_e, filePath) => {
  const buf = await fs.readFile(filePath);
  // Hand over the bytes without copying them again on the way out.
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
});

// Workers plan in parallel before anything is written, so the plan is made
// here in one process, once per run: two photos with one stem (photo.heic,
// photo.tiff) can never be given the same name, and "Replace it" can never
// replace IMG_0001.JPG with IMG_0001.HEIC.
ipcMain.handle('fs:startRun', (_e, sourcePaths, settings) => {
  const files = (sourcePaths || []).map((p) => ({ path: path.resolve(p), from: cameFrom.get(path.resolve(p)) || null }));
  planner = createBatchPlanner({
    path,
    platform: process.platform,
    files,
    settings: { format: settings.format, onExisting: settings.onExisting, outDir: settings.outDir || null, beside: Boolean(settings.beside) },
    kit,
    exists: (p) => fsSync.existsSync(p),
    ours: isOurs,
  });
});

ipcMain.handle('fs:plan', async (_e, { sourcePath }) => planner.plan(path.resolve(sourcePath), () => readHead(sourcePath)));

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

ipcMain.handle('fs:write', async (_e, { targetPath, bytes, sourcePath, keepDate, folder }) => {
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
  const temp = tempPath(targetPath, unique);
  try {
    await fs.writeFile(temp, Buffer.from(bytes));
    await fs.rename(temp, targetPath);
  } catch (err) {
    try { await fs.unlink(temp); } catch { /* nothing to clean up */ }
    tidy(path.dirname(targetPath), folder);
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

// A photo that needs no conversion, copied into a results folder as it is.
ipcMain.handle('fs:copy', async (_e, { targetPath, sourcePath, keepDate, folder }) => {
  if (isSameFile(targetPath, sourcePath)) {
    throw new Error('Refusing to write over the original file');
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const unique = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const temp = tempPath(targetPath, unique);
  try {
    await fs.copyFile(sourcePath, temp);
    await fs.rename(temp, targetPath);
  } catch (err) {
    try { await fs.unlink(temp); } catch { /* nothing to clean up */ }
    tidy(path.dirname(targetPath), folder);
    throw err;
  }
  if (keepDate) {
    try {
      const stat = await fs.stat(sourcePath);
      await fs.utimes(targetPath, stat.atime, stat.mtime);
    } catch { /* the copy is made; the timestamp is a nicety */ }
  }
  return true;
});

ipcMain.handle('app:licenses', () => openLicenses());

// The tool's own skill, for the start screen's Copy skill. The bundle copies
// agents/skills/justjpeg/SKILL.md into app/skill/, so it is read the same way
// from a checkout and from the packaged app (which ships app/, not agents/).
ipcMain.handle('app:skill', () => fs.readFile(path.join(APP_DIR, 'skill', 'SKILL.md'), 'utf8'));

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
      // A first instance still hidden (see showWhenReady) comes up now.
      if (!mainWindow.isVisible()) mainWindow.show();
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
