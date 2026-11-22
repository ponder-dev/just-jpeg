'use strict';

/*
 * The tar.gz's launcher (scripts/linux-after-pack.cjs) starts the app with
 * --no-sandbox only where Chromium's sandbox cannot work. Runs the real
 * generated launcher against a stand-in binary that prints its arguments, with
 * `unshare` and `stat` stood in for too, so each case can be had on any OS.
 */

// The launcher is a shell script for Linux only, and this test runs it with
// stand-in commands; Windows has no sh to run it with.
if (process.platform === 'win32') { console.log('linux launcher: skipped on Windows'); process.exit(0); }

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const afterPack = require('../scripts/linux-after-pack.cjs');

const pkg = require('../package.json');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-test-'));
const out = path.join(root, 'out');
const bin = path.join(root, 'bin');
fs.mkdirSync(out); fs.mkdirSync(bin);

// What electron-builder hands the hook, as far as the hook looks.
// Its own stand-in project folder holding only the icon the hook copies, so a
// fresh checkout (CI runs this before the icons are made) needs nothing generated.
const project = path.join(root, 'project');
fs.mkdirSync(path.join(project, 'build', 'icon.iconset'), { recursive: true });
fs.writeFileSync(path.join(project, 'build', 'icon.iconset', 'icon_512x512.png'), 'png');
const context = {
  electronPlatformName: 'linux',
  appOutDir: out,
  packager: {
    projectDir: project,
    executableName: pkg.name + '-app',
    appInfo: { productName: pkg.productName },
    info: { metadata: pkg },
    platformSpecificBuildOptions: { category: 'AudioVideo' },
  },
};

const stub = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
const run = (args, { userns, helper, env = {} }) => {
  stub('unshare', userns ? 'exit 0' : 'exit 1');
  stub('stat', `echo "${helper}"`);
  fs.writeFileSync(path.join(out, 'chrome-sandbox'), '');
  return execFileSync(path.join(out, pkg.name), args, { env: { PATH: bin + ':/usr/bin:/bin', ...env }, encoding: 'utf8' }).trim();
};

(async () => {
  await afterPack(context);
  fs.writeFileSync(path.join(out, pkg.name + '-app'), '#!/bin/sh\necho "ran: $*"\n', { mode: 0o755 });

  assert.strictEqual(run([], { userns: true, helper: '1000 755' }), 'ran:', 'user namespaces work: runs sandboxed');
  assert.strictEqual(run(['a b'], { userns: true, helper: '1000 755' }), 'ran: a b', 'arguments pass through');
  assert.strictEqual(run([], { userns: false, helper: '1000 755' }), 'ran: --no-sandbox', 'no namespaces and no root-owned helper: --no-sandbox');
  assert.strictEqual(run([], { userns: false, helper: '0 4755' }), 'ran:', 'a root-owned setuid helper: runs sandboxed');
  assert.strictEqual(run(['--no-sandbox'], { userns: false, helper: '1000 755' }), 'ran: --no-sandbox', 'asked for --no-sandbox: not added twice');
  // The command line inside the app runs as node: no browser, so no sandbox flag, even where the sandbox cannot work.
  assert.strictEqual(run(['cli.cjs', 'a'], { userns: false, helper: '1000 755', env: { ELECTRON_RUN_AS_NODE: '1' } }), 'ran: cli.cjs a', 'ELECTRON_RUN_AS_NODE: passed straight through');

  const desktop = fs.readFileSync(path.join(out, 'install-desktop-entry.sh'), 'utf8');
  assert.ok(desktop.includes(`Name=${pkg.productName}`) && desktop.includes(`Icon=${pkg.desktopName.replace('.desktop', '')}`), 'the menu entry carries the name and the icon');
  assert.ok(fs.existsSync(path.join(out, 'icon.png')), 'the icon ships in the folder');

  // The menu entry's script, run against a fake home, writes a desktop file that points at the launcher.
  const home = path.join(root, 'data');
  execFileSync('sh', [path.join(out, 'install-desktop-entry.sh')], { env: { PATH: '/usr/bin:/bin', XDG_DATA_HOME: home, HOME: root } });
  const entry = fs.readFileSync(path.join(home, 'applications', pkg.desktopName), 'utf8');
  assert.ok(entry.includes(`Exec="${fs.realpathSync(out)}/${pkg.name}" %U`), 'the entry runs this folder\'s launcher: ' + entry);
  assert.ok(entry.includes(`StartupWMClass=${pkg.productName}\n`), 'the entry finds the window by its app id, the tool\'s name (kit window.cjs)');
  assert.ok(desktop.includes('gtk-update-icon-cache -q -f '), 'the icon cache is rebuilt even when written in the same second');
  const builder = fs.readFileSync(path.join(__dirname, '..', 'electron-builder.yml'), 'utf8');
  assert.ok(builder.includes(`StartupWMClass: ${pkg.productName}\n`), 'the AppImage\'s own entry finds the window the same way');
  assert.ok(fs.existsSync(path.join(home, 'icons', 'hicolor', '512x512', 'apps', pkg.desktopName.replace('.desktop', '') + '.png')), 'the icon is installed');
  console.log('linux launcher: 12 passed');
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => fs.rmSync(root, { recursive: true, force: true }));
