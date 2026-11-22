// The only bridge between the UI and the filesystem. Everything the renderer
// can do to a user's disk is enumerated here.

const { contextBridge, ipcRenderer, webUtils } = require('electron');

// The tool's version, put on argv by main (a sandboxed preload cannot read
// package.json), for the start screen and the footer.
const version = (process.argv.find((a) => a.startsWith('--app-version=')) || '').slice('--app-version='.length);

contextBridge.exposeInMainWorld('ponder', {
  version,
  info: () => ipcRenderer.invoke('app:info'),

  pickInput: () => ipcRenderer.invoke('dialog:pickInput'),
  // Folders alone, where the file picker cannot take them (Windows, Linux).
  pickFolder: () => ipcRenderer.invoke('dialog:pickFolder'),
  folderButton: process.platform !== 'darwin',
  pickOutput: () => ipcRenderer.invoke('dialog:pickOutput'),

  scan: (paths) => ipcRenderer.invoke('fs:scan', paths),
  read: (filePath) => ipcRenderer.invoke('fs:read', filePath),
  startRun: (sourcePaths, settings) => ipcRenderer.invoke('fs:startRun', sourcePaths, settings),
  plan: (options) => ipcRenderer.invoke('fs:plan', options),
  copy: (options) => ipcRenderer.invoke('fs:copy', options),
  write: (options) => ipcRenderer.invoke('fs:write', options),

  licenses: () => ipcRenderer.invoke('app:licenses'),
  skill: () => ipcRenderer.invoke('app:skill'),
  reveal: (target) => ipcRenderer.invoke('shell:reveal', target),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // Electron dropped File.path, so dragged files resolve to real paths here.
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return null; }
  },
});
