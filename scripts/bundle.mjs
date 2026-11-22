// Builds src/ into app/, which is the only thing electron-builder ships.
//
// Bundling means node_modules never has to be packaged, so the installer stays
// small. The one exception is libraw, which is copied verbatim because it
// spawns its own worker and loads a sidecar .wasm at runtime.

import * as esbuild from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'app');

await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(path.join(out, 'renderer'), { recursive: true });

const common = {
  bundle: true,
  minify: true,
  sourcemap: false,
  logLevel: 'info',
  legalComments: 'none',
};

// Main and preload run in Node, so electron itself stays external.
await esbuild.build({
  ...common,
  entryPoints: [path.join(root, 'src/main.js')],
  outfile: path.join(out, 'main.cjs'),
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
});

await esbuild.build({
  ...common,
  entryPoints: [path.join(root, 'src/preload.js')],
  outfile: path.join(out, 'preload.cjs'),
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
});

// Renderer and worker are ES modules so `new URL(..., import.meta.url)`
// resolves correctly at runtime.
await esbuild.build({
  ...common,
  entryPoints: [
    path.join(root, 'src/renderer/app.js'),
    path.join(root, 'src/renderer/convert.worker.js'),
  ],
  outdir: path.join(out, 'renderer'),
  platform: 'browser',
  format: 'esm',
  target: 'chrome120',
  splitting: false,
  // The mozjpeg encoder normally fetches its .wasm at runtime. A file://
  // origin cannot do that, so inline it into the bundle instead.
  loader: { '.wasm': 'binary' },
});

// Static renderer assets: the page, and the kit it is built from (put in by
// bin/kit-sync in the workshop; copied as it is, never rebuilt here). The
// tool has no stylesheet of its own; the kit draws all of it.
await fs.copyFile(path.join(root, 'src/renderer/index.html'), path.join(out, 'renderer/index.html'));
await fs.cp(path.join(root, 'src/renderer/kit'), path.join(out, 'renderer/kit'), { recursive: true });

// The tool's skill, for Copy skill on the start screen. electron-builder
// ships app/ but not agents/, so it travels inside app/.
await fs.mkdir(path.join(out, 'skill'), { recursive: true });
await fs.copyFile(path.join(root, 'agents/skills/justjpeg/SKILL.md'), path.join(out, 'skill/SKILL.md'));

// Credits screen, built from the real licence files rather than a copy of
// them, so the text shown in the app is always the text we actually ship.
const escapeHtml = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// The kit it is built with, said on the page (decided 2026-11-20).
const kitVersion = JSON.parse(await fs.readFile(path.join(root, 'kit.lock'), 'utf8')).kit;
const notices = await fs.readFile(path.join(root, 'THIRD-PARTY-NOTICES.md'), 'utf8');
const licenseDir = path.join(root, 'licenses');
const licenseFiles = (await fs.readdir(licenseDir)).filter((f) => f.endsWith('.txt')).sort();

import { renderMarkdown } from './markdown-lite.mjs';

const sections = [];
for (const file of licenseFiles) {
  const text = await fs.readFile(path.join(licenseDir, file), 'utf8');
  sections.push(
    `<details><summary>${escapeHtml(file.replace(/\.txt$/, ''))}</summary><pre>${escapeHtml(text)}</pre></details>`,
  );
}

await fs.writeFile(path.join(out, 'renderer/licenses.html'), `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';" />
<title>Licences and credits</title>
<style>
  body { margin:0; padding:28px 34px; background:#12131a; color:#eceef5;
         font:13px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  h1 { font-size:18px; margin:0 0 4px; }
  .notices { color:#c3c8d8; }
  .notices h2 { font-size:15px; margin:22px 0 6px; color:#eceef5; }
  .notices h3 { font-size:13px; margin:16px 0 4px; color:#eceef5; }
  .notices p { margin:6px 0; }
  .notices ul, .notices ol { margin:6px 0; padding-left:22px; }
  .notices li { margin:3px 0; }
  .notices code { font:12px ui-monospace, Menlo, monospace; color:#eceef5; }
  .notices .url { color:#9aa0b4; word-break:break-all; }
  .notices hr { border:0; border-top:1px solid #2c2f3d; margin:18px 0; }
  details { border:1px solid #2c2f3d; border-radius:9px; margin:8px 0; background:#191b24; }
  summary { padding:9px 14px; cursor:pointer; font-weight:600; }
  details pre { margin:0; padding:0 14px 14px; max-height:340px; overflow:auto;
                white-space:pre-wrap; font:11px/1.5 ui-monospace, Menlo, monospace; color:#9aa0b4; }
  h2 { font-size:14px; margin:26px 0 6px; }
</style></head>
<body>
  <h1>Licences and credits</h1>
  <p>Built with the PonderDev kit ${kitVersion}, the parts every Just tool shares.</p>
  <div class="notices">${renderMarkdown(notices)}</div>
  <h2>Full licence texts</h2>
  ${sections.join('\n  ')}
</body></html>
`);

// libraw, copied whole.
const librawSrc = path.join(root, 'node_modules/libraw-wasm/dist');
const librawOut = path.join(out, 'renderer/vendor/libraw');
await fs.mkdir(librawOut, { recursive: true });
for (const entry of await fs.readdir(librawSrc)) {
  if (entry.endsWith('.map') || entry.endsWith('.d.ts')) continue;
  await fs.copyFile(path.join(librawSrc, entry), path.join(librawOut, entry));
}

// Report what we produced, since installer size is worth keeping an eye on.
async function measure(dir) {
  let total = 0;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? await measure(full) : (await fs.stat(full)).size;
  }
  return total;
}
console.log(`\napp/ is ${(await measure(out) / 1e6).toFixed(1)} MB`);
