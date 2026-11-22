'use strict';

/*
 * electron-builder afterPack hook, Linux only. Adds to the unpacked app the
 * three things the .tar.gz needs and the AppImage brings for itself:
 *
 *   <name>                      a launcher, so people run ./<name>. Electron's
 *                               real binary is <name>-app (linux.executableName).
 *                               The launcher starts it with Chromium's sandbox
 *                               where the system allows it, and without where
 *                               it does not (Ubuntu 24.04 forbids the user
 *                               namespaces the sandbox needs, and a tar.gz
 *                               cannot ship a root-owned setuid helper, so the
 *                               unpatched binary aborts at once).
 *   install-desktop-entry.sh    puts the app in the applications menu with its
 *                               icon and name, which a Linux desktop only does
 *                               for an app that has a .desktop file.
 *   icon.png                    the icon that script installs.
 *
 * The AppImage is built from the same folder. Its own launcher runs
 * <name>-app directly, so it never sees these files.
 */

const fs = require('node:fs');
const path = require('node:path');

const LAUNCHER = (app) => `#!/bin/sh
# Starts the app. Chromium's sandbox needs either unprivileged user namespaces
# or a setuid helper owned by root, and this folder has neither the helper nor,
# on some systems (Ubuntu 24.04), the namespaces. Where the sandbox cannot work
# the app is started without it, rather than not at all; everywhere else it
# runs sandboxed, as Chromium intends.
here=$(dirname "$(readlink -f "$0")")
case " $* " in *" --no-sandbox "*) exec "$here/${app}" "$@" ;; esac
# Run as node (the command line inside the app): no browser, no sandbox flag.
[ -n "$ELECTRON_RUN_AS_NODE" ] && exec "$here/${app}" "$@"
helper="$here/chrome-sandbox"
if unshare -Ur true 2>/dev/null; then
  exec "$here/${app}" "$@"
fi
if [ -f "$helper" ] && [ "$(stat -c '%u %a' "$helper" 2>/dev/null)" = "0 4755" ]; then
  exec "$here/${app}" "$@"
fi
exec "$here/${app}" --no-sandbox "$@"
`;

const INSTALLER = (product, id, launcher, categories) => `#!/bin/sh
# Adds ${product} to your applications menu, with its icon, for your user only.
# Run it again if you move this folder. Remove it with:
#   rm ~/.local/share/applications/${id}.desktop ~/.local/share/icons/hicolor/512x512/apps/${id}.png
here=$(dirname "$(readlink -f "$0")")
data="\${XDG_DATA_HOME:-$HOME/.local/share}"
mkdir -p "$data/applications" "$data/icons/hicolor/512x512/apps"
cp "$here/icon.png" "$data/icons/hicolor/512x512/apps/${id}.png"
cat > "$data/applications/${id}.desktop" <<ENTRY
[Desktop Entry]
Type=Application
Name=${product}
Exec="$here/${launcher}" %U
Icon=${id}
Terminal=false
StartupWMClass=${product}
Categories=${categories}
ENTRY
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$data/applications" 2>/dev/null
# -f: a cache written in the same second (another tool's script run just before)
# looks up to date and would keep only that tool's icon.
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -f -t "$data/icons/hicolor" 2>/dev/null
echo "${product} is in your applications menu."
`;

module.exports = async function linuxAfterPack(context) {
  if (context.electronPlatformName !== 'linux') return;
  const { appOutDir, packager } = context;
  const meta = packager.info.metadata;
  const launcher = String(meta.name);
  const binary = packager.executableName;
  const product = packager.appInfo.productName;
  const id = String(meta.desktopName || '').replace(/\.desktop$/, '');
  if (!id) throw new Error('package.json needs a desktopName for the Linux build');
  if (binary === launcher) throw new Error(`linux.executableName must differ from "${launcher}", the launcher's name`);
  const categories = String((packager.platformSpecificBuildOptions || {}).category || 'Utility').replace(/;?$/, ';');

  const write = (name, text) => fs.writeFileSync(path.join(appOutDir, name), text, { mode: 0o755 });
  write(launcher, LAUNCHER(binary));
  write('install-desktop-entry.sh', INSTALLER(product, id, launcher, categories));
  // The 512 px size of the iconset (npm run icon:raster makes it from the vector;
  // it is not in git). Said plainly if it is missing, rather than a bare ENOENT.
  const icon = path.join(packager.projectDir, 'build', 'icon.iconset', 'icon_512x512.png');
  if (!fs.existsSync(icon)) throw new Error('build/icon.iconset/icon_512x512.png is missing: run npm run icon:svg && npm run icon:raster first');
  fs.copyFileSync(icon, path.join(appOutDir, 'icon.png'));
};
