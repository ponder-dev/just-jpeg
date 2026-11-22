// Renders build/icon.svg to build/icon.png at 1024x1024, to the iconset
// sizes macOS actually shows, and to build/icon.ico for Windows.
//
// Windows draws its icons edge to edge, where a Mac icon sits inset in its
// canvas (824 of 1024). Packed as it is, ours looked small and soft in the
// taskbar beside Explorer and Edge. So the Windows set is the same vector
// with its view cropped to the art plus a thin margin, and every size Windows
// asks for at 100%, 125%, 150% and 200% (16, 20, 24, 32, 40, 48, 64, 256) is
// rendered at that size; none is left for Windows to scale from another.
//
// ImageMagick's built-in SVG renderer drops gradients, and the house tile is
// nothing but a gradient, so we let Chromium do it instead. Every size is
// rendered from the vector rather than downscaled from the 1024, because the
// small entries are where the icon lives or dies: 16 and 32 get a shape drawn
// at that size with the hinting Chromium gives it, not a blur of the big one.
//
//   electron scripts/icons.cjs

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const MAIN = 1024;
const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'build/icon.svg'), 'utf8');

// name:pixels. macOS wants both the 1x and 2x of each logical size, and the
// same pixel size is asked for twice under two names on purpose.
const ICONSET = [
  ['icon_16x16', 16],
  ['icon_16x16@2x', 32],
  ['icon_32x32', 32],
  ['icon_32x32@2x', 64],
  ['icon_128x128', 128],
  ['icon_128x128@2x', 256],
  ['icon_256x256', 256],
  ['icon_256x256@2x', 512],
  ['icon_512x512', 512],
  ['icon_512x512@2x', 1024],
];

// The Windows icon: every size the shell asks for, each from the vector.
const WINDOWS = [16, 20, 24, 32, 40, 48, 64, 128, 256];
// The art's box in the 1024 canvas (scripts/make-icon.mjs: ART 824, centred),
// and the margin Windows icons keep around it (about one pixel at 32).
const ART = 824;
const MARGIN = 26;
const WINDOWS_VIEW = `${(MAIN - ART) / 2 - MARGIN} ${(MAIN - ART) / 2 - MARGIN} ${ART + 2 * MARGIN} ${ART + 2 * MARGIN}`;

app.disableHardwareAcceleration();

/** The icon's markup, with its outer view box replaced when given. */
function markup(view) {
  if (!view) return svg;
  return svg.replace(/(<svg\b[^>]*?)\sviewBox="[^"]*"/, `$1 viewBox="${view}"`);
}

function page(size, view) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;background:transparent;width:${size}px;height:${size}px;overflow:hidden}
  svg{display:block;width:${size}px;height:${size}px}
</style></head><body>${markup(view)}</body></html>`;
}

/** PNG images (pixels, bytes) packed into one .ico, PNG entries throughout. */
function ico(entries) {
  const head = Buffer.alloc(6 + 16 * entries.length);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2);                        // an icon
  head.writeUInt16LE(entries.length, 4);
  let offset = head.length;
  entries.forEach(([size, png], i) => {
    const at = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, at);     // 0 means 256
    head.writeUInt8(size >= 256 ? 0 : size, at + 1);
    head.writeUInt16LE(1, at + 4);                 // colour planes
    head.writeUInt16LE(32, at + 6);                // bits per pixel
    head.writeUInt32LE(png.length, at + 8);
    head.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...entries.map(([, png]) => png)]);
}

async function render(win, size, view) {
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(page(size, view)));
  // Give the renderer a frame to paint the gradients before we grab it.
  await new Promise((r) => setTimeout(r, 250));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  return image.toPNG();
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: MAIN,
    height: MAIN,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    useContentSize: true,
    webPreferences: { offscreen: true },
  });

  const png = await render(win, MAIN);
  fs.writeFileSync(path.join(root, 'build/icon.png'), png);
  console.log(`build/icon.png written, ${(png.length / 1024).toFixed(0)}KB, ${MAIN}x${MAIN}`);

  const set = path.join(root, 'build/icon.iconset');
  fs.rmSync(set, { recursive: true, force: true });
  fs.mkdirSync(set, { recursive: true });

  // Cache by pixel size, so 32 and 256 are not rendered twice for their two
  // names, and the two files are byte identical when they should be.
  const byPixels = new Map();
  for (const [name, size] of ICONSET) {
    if (!byPixels.has(size)) byPixels.set(size, await render(win, size));
    fs.writeFileSync(path.join(set, `${name}.png`), byPixels.get(size));
  }
  console.log(`build/icon.iconset written, ${ICONSET.length} entries`);

  const windows = [];
  for (const size of WINDOWS) windows.push([size, await render(win, size, WINDOWS_VIEW)]);
  fs.writeFileSync(path.join(root, 'build/icon.ico'), ico(windows));
  console.log(`build/icon.ico written, ${WINDOWS.join(', ')} px, the art filling the square`);

  app.exit(0);
});
