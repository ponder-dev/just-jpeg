// Renders build/icon.svg to build/icon.png at 1024x1024.
//
// ImageMagick's built-in SVG renderer drops gradients, so we let Chromium do
// it instead. electron-builder turns the resulting PNG into .icns and .ico.
//
//   npx electron scripts/icons.cjs

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SIZE = 1024;
const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'build/icon.svg'), 'utf8');

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:transparent;width:${SIZE}px;height:${SIZE}px;overflow:hidden}
  svg{display:block;width:${SIZE}px;height:${SIZE}px}
</style></head><body>${svg}</body></html>`;

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: SIZE,
    height: SIZE,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    useContentSize: true,
    webPreferences: { offscreen: true },
  });

  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  // Give the renderer a frame to paint the gradients before we grab it.
  await new Promise((r) => setTimeout(r, 600));

  const image = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  const png = image.toPNG();
  fs.writeFileSync(path.join(root, 'build/icon.png'), png);
  console.log(`build/icon.png written, ${(png.length / 1024).toFixed(0)}KB, ${image.getSize().width}x${image.getSize().height}`);
  app.exit(0);
});
