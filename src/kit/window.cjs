/* PonderDev kit 1.0.0, built from kit/src. Do not edit: run bin/kit-sync. */
'use strict';
/*
 * kit, main side: every Just tool window's frame (decided 2026-11-20).
 *
 * On Windows and Linux the app draws its own title bar in its own dark
 * background, with the system's minimise, maximise and close buttons drawn
 * over it in matching colours (Electron's titleBarOverlay), so no tool shows
 * a white frame around a dark app. On a Mac the traffic lights sit over the
 * page as before (hiddenInset).
 *
 *   const { frame, dress } = require('./kit/window.cjs');
 *   win = new BrowserWindow({ width: 720, height: 780, ...frame(), webPreferences: {...} });
 *   dress(win);
 *
 * frame() gives the window's options: the frame, and backgroundColor (the
 * kit's --bg, so nothing flashes white while the page loads). dress(win) puts
 * the strip the title bar is drawn on into every page the window loads, a
 * page of the tool's own or one without the kit (the licences page): the
 * window's title on the left, room for the system buttons on the right, and
 * the whole strip drags the window. A page that already has a .titlebar
 * keeps it, and gets the title written into it.
 *
 * On Linux frame() also gives the window the tool's own name as its app id
 * ("Just Cut"). A Linux desktop names a window it has no menu entry for by its
 * app id alone (GNOME's dock does), so an AppImage run straight from Downloads
 * shows "Just Cut" there, not "com.ponderdev.justcut". A menu entry finds the
 * window by StartupWMClass, which the tool's Linux build sets to the same name.
 */

// The kit's --bg and --text (kit/src/tokens.css; the kit's tests compare them).
const BG = '#12131a';
const TEXT = '#eceef5';
const MUTED = '#9aa0b4';
// The strip's height on Windows and Linux: the system buttons' own height.
const HEIGHT = 32;

// Electron reads the app id from the desktop name (minus ".desktop") each
// time it makes a window, so this has to run before the first window: frame()
// is called in the window's options. Only in Electron's main process.
function linuxName(app, platform = process.platform) {
  if (platform !== 'linux' || !app || typeof app.setDesktopName !== 'function') return;
  app.setDesktopName(`${app.getName()}.desktop`);
}

function frame(platform = process.platform) {
  if (platform === 'linux' && process.type === 'browser') linuxName(require('electron').app, platform);
  if (platform === 'darwin') return { titleBarStyle: 'hiddenInset', backgroundColor: BG };
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: BG, symbolColor: TEXT, height: HEIGHT },
    backgroundColor: BG,
  };
}

// The strip, for any page. env(titlebar-area-*) is where the page may draw
// beside the system buttons; the fallbacks are for a window without them.
const CSS = `
.titlebar { height: ${HEIGHT}px; flex: none; display: flex; align-items: center; -webkit-app-region: drag;
  background: ${BG}; position: relative; z-index: 10; }
.titlebar .k-titlebar-name { padding-left: calc(env(titlebar-area-x, 0px) + 14px); max-width: env(titlebar-area-width, 100%);
  font: 12px/1 system-ui, -apple-system, "Segoe UI", Ubuntu, sans-serif; color: ${MUTED};
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; user-select: none; }
body.k-doc > .titlebar, body > .titlebar:first-child { margin: 0; }
`;

// Runs in the page: a .titlebar first in the body (made if the page has none),
// with the window's title in it. DOM calls only, so a page's own
// Content-Security-Policy (no scripts, no inline styles) does not stop it.
const PUT = `(() => {
  let bar = document.querySelector('.titlebar');
  if (!bar) { bar = document.createElement('div'); bar.className = 'titlebar'; document.body.prepend(bar); }
  if (!bar.querySelector('.k-titlebar-name')) {
    const name = document.createElement('span');
    name.className = 'k-titlebar-name';
    bar.append(name);
  }
  bar.querySelector('.k-titlebar-name').textContent = document.title;
  return true;
})()`;

function dress(win, platform = process.platform) {
  if (platform === 'darwin') return;
  const contents = win.webContents;
  contents.on('dom-ready', () => {
    contents.insertCSS(CSS).catch(() => {});
    contents.executeJavaScript(PUT).catch(() => {});
  });
  // A page that changes its title (a file's name, say) keeps the strip true.
  win.on('page-title-updated', () => { contents.executeJavaScript(PUT).catch(() => {}); });
}

module.exports = { frame, dress, linuxName, BG, TEXT, HEIGHT, CSS };
