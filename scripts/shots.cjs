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
const WIDTH = 720;
const SCALE = 2;

// The run part is drawn straight from the kit for the working and done shots:
// a fresh Kit.run on #run, with the words a real run of 3,847 photos shows.
const RUN = `const run = Kit.run(document.getElementById('run'));
      document.getElementById('plan-note').textContent = '';`;
const QUEUE = `run.queue([4466, 4467, 4468, 4469, 4470, 4471, 4472, 4473].map((n) => ({
        name: 'IMG_' + n + '.HEIC', state: n < 4470 ? 'done' : n < 4472 ? 'working' : 'waiting' })));`;

// Each shot: a name, and the script that puts the UI into that state.
const SHOTS = [
  {
    name: 'drop',
    height: 620,
    setup: '',
  },
  {
    // Tall enough that the whole options panel is visible without scrolling.
    // The stand-in preload answers the choose button with a folder of photos.
    name: 'settings',
    height: 1110,
    setup: `
      document.getElementById('btn-choose').click();
    `,
  },
  {
    name: 'progress',
    height: 1400,
    setup: `
      ${RUN}
      document.getElementById('btn-convert').disabled = true;
      run.working({ what: 'Converting to JPEG', count: '2,385 of 3,847', fraction: 0.62,
        file: 'IMG_4471.HEIC', left: 'About 5 minutes left' });
      ${QUEUE}
    `,
  },
  {
    name: 'done',
    height: 1400,
    setup: `
      ${RUN}
      document.getElementById('btn-convert').disabled = false;
      run.queue([4843, 4844, 4845, 4846, 4847].map((n) => ({ name: 'IMG_' + n + '.HEIC', state: 'done' })));
      run.done({ title: 'Done. 3,847 photos converted', detail: '4.9 GB of JPEG in 13 minutes',
        where: 'Saved next to the originals in Beach vacation' });
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
    // In a block of its own, so each shot's names start fresh.
    if (shot.setup) await win.webContents.executeJavaScript(`{ ${shot.setup} }`);
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
