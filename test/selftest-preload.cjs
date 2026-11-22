const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('t', {
  cases: () => ipcRenderer.invoke('cases'),
  fixture: (n) => ipcRenderer.invoke('fixture', n),
  save: (o) => ipcRenderer.invoke('save', o),
  nodeRaw: (n) => ipcRenderer.invoke('node-raw', n),
  report: (r) => ipcRenderer.invoke('report', r),
});
