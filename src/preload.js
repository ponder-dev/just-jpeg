// The only bridge between the UI and the filesystem. Everything the renderer
// can do to a user's disk is enumerated here.

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('ponder', {
  info: () => ipcRenderer.invoke('app:info'),

  pickInput: () => ipcRenderer.invoke('dialog:pickInput'),
  pickOutput: () => ipcRenderer.invoke('dialog:pickOutput'),

  scan: (paths) => ipcRenderer.invoke('fs:scan', paths),
  read: (filePath) => ipcRenderer.invoke('fs:read', filePath),
  plan: (options) => ipcRenderer.invoke('fs:plan', options),
  write: (options) => ipcRenderer.invoke('fs:write', options),

  licenses: () => ipcRenderer.invoke('app:licenses'),
  reveal: (target) => ipcRenderer.invoke('shell:reveal', target),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // Electron dropped File.path, so dragged files resolve to real paths here.
  pathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return null; }
  },
});
