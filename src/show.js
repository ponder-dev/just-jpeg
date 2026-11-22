// Just JPEG's main window, shown once it can paint (main.js).

// The window is made hidden so it never flashes white, then shown once it can
// paint. 'ready-to-show' alone is not enough: on Wayland a hidden window is not
// mapped, so Chromium may never draw the first frame and the event never comes
// (Ubuntu 24.04 GNOME: a running app with no window). So the page finishing its
// load shows it too, and so does a short timer if neither has happened.
export const SHOW_FALLBACK_MS = 2500;
// timers: stand-ins for the clock in its test.
export function showWhenReady(win, { env = process.env, timers = { setTimeout, clearTimeout } } = {}) {
  if (env.JUSTJPEG_TEST_OFFSCREEN) return; // the window test draws off screen, never shown
  const show = () => { if (!win.isDestroyed() && !win.isVisible()) win.show(); };
  win.once('ready-to-show', show);
  win.webContents.once('did-finish-load', show);
  const timer = timers.setTimeout(show, SHOW_FALLBACK_MS);
  win.once('closed', () => timers.clearTimeout(timer));
}
