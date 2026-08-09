// Stand-in for the real preload, used only when capturing screenshots.
// Exposes the same surface so the UI boots, but touches nothing on disk.

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('ponder', {
  info: async () => ({ platform: process.platform, version: '1.0.0', cores: 8 }),
  pickInput: async () => [],
  pickOutput: async () => null,
  scan: async () => [],
  read: async () => new ArrayBuffer(0),
  plan: async () => ({ path: '', action: 'skip' }),
  write: async () => true,
  licenses: async () => {},
  reveal: async () => {},
  openExternal: async () => {},
  pathForFile: () => null,
});
