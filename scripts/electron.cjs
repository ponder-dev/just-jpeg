'use strict';

/*
 * Runs Electron with ELECTRON_RUN_AS_NODE taken out of its environment.
 *
 *   node scripts/electron.cjs test/window.test.cjs [more arguments]
 *
 * Some shells and editors set ELECTRON_RUN_AS_NODE, and with it set Electron
 * starts as plain node and the window tests fail in ways that look like a bug
 * in the window. "env -u" fixed that on mac and Linux and does not exist on
 * Windows, so the npm scripts go through this instead and work on all three.
 */

const { spawn } = require('node:child_process');

// Under plain node, the electron package exports the path to its binary.
const electron = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, process.argv.slice(2), { stdio: 'inherit', env, windowsHide: false });
child.on('error', (err) => { console.error(err.message); process.exit(1); });
child.on('close', (code, signal) => process.exit(code == null ? (signal ? 1 : 0) : code));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
