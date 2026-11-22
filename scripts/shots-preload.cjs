// Stand-in for the real preload, used only when capturing screenshots.
// Exposes the same surface so the UI boots, but touches nothing on disk.

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('ponder', {
  info: async () => ({ platform: process.platform, version: '1.0.0', cores: 8 }),
  // A made-up folder of photos, so the settings have something to show.
  pickInput: async () => ['/Photos/Beach vacation'],
  pickOutput: async () => null,
  scan: async () => Array.from({ length: 3847 }, (_, i) => ({
    path: `/Photos/Beach vacation/IMG_${1000 + i}.HEIC`, name: `IMG_${1000 + i}.HEIC`, size: 3100000,
  })),
  startRun: async () => {},
  read: async () => new ArrayBuffer(0),
  plan: async () => ({ path: '', action: 'skip' }),
  write: async () => true,
  licenses: async () => {},
  skill: async () => '',
  reveal: async () => {},
  openExternal: async () => {},
  pathForFile: () => null,
});
