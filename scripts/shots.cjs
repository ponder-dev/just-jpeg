// Captures the app's own interface, offscreen, at 2x.
//
// Renders app/renderer/index.html in a real Chromium window that is never
// shown, then drives the DOM into each state and grabs a picture. Nothing on
// the desktop is captured, and no real files are read.
//
//   npx electron scripts/shots.cjs

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'shots');
const WIDTH = 940;
const SCALE = 2;

// Each shot: a name, and the script that puts the UI into that state.
const SHOTS = [
  {
    name: 'drop',
    height: 620,
    setup: `
      document.getElementById('view-drop').classList.remove('hidden');
    `,
  },
  {
    // Tall enough that the whole options panel is visible without scrolling.
    name: 'settings',
    height: 1010,
    setup: `
      for (const v of ['drop','settings','progress','done'])
        document.getElementById('view-' + v).classList.toggle('hidden', v !== 'settings');
      document.getElementById('file-summary').textContent = '3,847 photos';
      document.getElementById('file-detail').textContent = '11.4 GB in total';
      document.getElementById('output-label').textContent = 'Next to each original';
      document.getElementById('plan-note').textContent = 'Roughly 14 minutes';
    `,
  },
  {
    name: 'progress',
    height: 520,
    setup: `
      for (const v of ['drop','settings','progress','done'])
        document.getElementById('view-' + v).classList.toggle('hidden', v !== 'progress');
      document.getElementById('progress-title').textContent = 'Converting to JPEG';
      document.getElementById('progress-fill').style.width = '62%';
      document.getElementById('progress-count').textContent = '2,385 of 3,847';
      document.getElementById('progress-file').textContent = 'IMG_4471.HEIC';
      document.getElementById('progress-eta').textContent = 'About 5 minutes left';
    `,
  },
  {
    name: 'done',
    height: 520,
    setup: `
      for (const v of ['drop','settings','progress','done'])
        document.getElementById('view-' + v).classList.toggle('hidden', v !== 'done');
      document.getElementById('done-title').textContent = 'All done';
      document.getElementById('done-summary').textContent = '3,847 photos converted';
      document.getElementById('done-saved').textContent =
        '4.9 GB of JPEG saved next to the originals, in 13 minutes.';
    `,
  },
];

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  fs.mkdirSync(outDir, { recursive: true });

  const win = new BrowserWindow({
    width: WIDTH,
    height: 700,
    show: false,
    frame: false,
    useContentSize: true,
    backgroundColor: '#12131a',
    webPreferences: {
      preload: path.join(__dirname, 'shots-preload.cjs'),
      contextIsolation: true,
      offscreen: true,
      zoomFactor: SCALE,
    },
  });

  await win.loadFile(path.join(root, 'app/renderer/index.html'));
  await new Promise((r) => setTimeout(r, 900));

  for (const shot of SHOTS) {
    // Offscreen rendering at 2x: the page lays out at logical size, so the
    // window is scaled up to match.
    win.setSize(WIDTH * SCALE, shot.height * SCALE);
    await win.webContents.executeJavaScript(shot.setup);
    await new Promise((r) => setTimeout(r, 450));
    const image = await win.webContents.capturePage();
    const file = path.join(outDir, `${shot.name}.png`);
    fs.writeFileSync(file, image.toPNG());
    const { width, height } = image.getSize();
    console.log(`  ${shot.name.padEnd(10)} ${width}x${height}`);
  }

  console.log(`\nwrote ${SHOTS.length} shots to shots/`);
  app.exit(0);
});

setTimeout(() => { console.error('timed out'); app.exit(2); }, 90000);
