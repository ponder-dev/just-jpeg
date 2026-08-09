const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('t', {
  cases: () => ipcRenderer.invoke('cases'),
  fixture: (n) => ipcRenderer.invoke('fixture', n),
  save: (o) => ipcRenderer.invoke('save', o),
  report: (r) => ipcRenderer.invoke('report', r),
});
