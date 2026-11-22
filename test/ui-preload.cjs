// The UI test's stand-in for the real preload: the same surface, answered by
// test/ui.test.cjs from the fixtures and a temporary folder.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ponder', {
  info: async () => ({ platform: process.platform, version: '0.0.0-test', cores: 4 }),
  pickInput: () => ipcRenderer.invoke('ui:pick'),
  pickFolder: () => ipcRenderer.invoke('ui:pick'),
  folderButton: process.platform !== 'darwin',
  pickOutput: () => ipcRenderer.invoke('ui:pickOutput'),
  scan: () => ipcRenderer.invoke('ui:scan'),
  read: (p) => ipcRenderer.invoke('ui:read', p),
  startRun: () => ipcRenderer.invoke('ui:startRun'),
  plan: (o) => ipcRenderer.invoke('ui:plan', o),
  write: (o) => ipcRenderer.invoke('ui:write', o),
  licenses: async () => {},
  skill: () => ipcRenderer.invoke('ui:skill'),
  reveal: async () => {},
  openExternal: (url) => ipcRenderer.invoke('ui:open', url),
  pathForFile: (f) => f.name,
});
