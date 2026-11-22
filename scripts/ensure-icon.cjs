'use strict';
// build/icon.png is not in git (it is made from build/icon.svg), and the
// Windows and Linux installers pack it. Make it when it is not there, so a
// fresh checkout's `npm run dist:win` or `dist:linux` has an icon. CI makes it
// in its own step first (with the flags a runner needs), so there it is a no-op.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
// The iconset too: the Linux build's menu-entry script ships its 512 px icon;
// and the .ico, which the Windows build packs.
if (!fs.existsSync(path.join(root, 'build', 'icon.png')) || !fs.existsSync(path.join(root, 'build', 'icon.iconset', 'icon_512x512.png')) || !fs.existsSync(path.join(root, 'build', 'icon.ico'))) {
  execSync('npm run icon:png', { cwd: root, stdio: 'inherit' });
}
