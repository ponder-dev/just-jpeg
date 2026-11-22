// The main window is shown on the first of ready-to-show, the page's load, or
// a short timer (src/show.js): on Wayland a hidden window may never send
// ready-to-show, which left a running app with no window (Ubuntu 24.04 GNOME).
import assert from 'node:assert';
import { EventEmitter } from 'node:events';
import { showWhenReady, SHOW_FALLBACK_MS } from '../src/show.js';

function fakeWindow() {
  const win = new EventEmitter();
  win.webContents = new EventEmitter();
  win.shown = 0; win.visible = false; win.destroyed = false;
  win.isDestroyed = () => win.destroyed;
  win.isVisible = () => win.visible;
  win.show = () => { win.shown++; win.visible = true; };
  return win;
}
function fakeTimers() {
  const t = { pending: [], setTimeout: (fn, ms) => { const h = { fn, ms }; t.pending.push(h); return h; }, clearTimeout: (h) => { t.pending = t.pending.filter((x) => x !== h); } };
  t.fire = () => { const now = t.pending; t.pending = []; now.forEach((h) => h.fn()); };
  return t;
}
let passed = 0;
const check = (name, fn) => { fn(); passed++; };

check('ready-to-show never comes: the timer shows it', () => {
  const win = fakeWindow(), timers = fakeTimers();
  showWhenReady(win, { env: {}, timers });
  assert.equal(win.shown, 0);
  assert.equal(timers.pending[0].ms, SHOW_FALLBACK_MS);
  timers.fire();
  assert.equal(win.shown, 1);
});
check('the page loads first: shown then, and once only', () => {
  const win = fakeWindow(), timers = fakeTimers();
  showWhenReady(win, { env: {}, timers });
  win.webContents.emit('did-finish-load');
  win.emit('ready-to-show');
  timers.fire();
  assert.equal(win.shown, 1);
});
check('ready-to-show: shown', () => {
  const win = fakeWindow(), timers = fakeTimers();
  showWhenReady(win, { env: {}, timers });
  win.emit('ready-to-show');
  assert.equal(win.shown, 1);
});
check('closed before any of them: the timer is cleared and nothing is shown', () => {
  const win = fakeWindow(), timers = fakeTimers();
  showWhenReady(win, { env: {}, timers });
  win.emit('closed');
  assert.equal(timers.pending.length, 0);
  win.destroyed = true;
  win.webContents.emit('did-finish-load');
  assert.equal(win.shown, 0);
});
check('the offscreen window test: never shown', () => {
  const win = fakeWindow(), timers = fakeTimers();
  showWhenReady(win, { env: { JUSTJPEG_TEST_OFFSCREEN: '1' }, timers });
  win.emit('ready-to-show'); timers.fire();
  assert.equal(win.shown, 0);
});
console.log(`show when ready: ${passed} passed`);
