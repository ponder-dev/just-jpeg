#!/usr/bin/env node
'use strict';
// Links this tool's agent skill into the folders AI assistants read skills
// from, when the command line is installed globally with npm, so the skill
// always matches the installed version (decided 2026-11-15: every Just tool
// ships its own skill; 2026-11-16: link it for Claude and for the shared folder).
//
// Two places, each with the same rules:
//
//   - Claude Code: ~/.claude/skills/<tool>, or $CLAUDE_CONFIG_DIR/skills/<tool>,
//     when that folder exists.
//   - The shared folder most other assistants read (Codex, Gemini CLI,
//     Copilot, Cursor, OpenCode, Amp, Goose): ~/.agents/skills/<tool>, when
//     ~/.agents exists or one of those assistants is set up here. If only the
//     assistant is there, ~/.agents/skills is made for the link.
//
// npm runs this as the package's postinstall. It does nothing unless the
// install is global (npm install -g), never in a project's node_modules or a
// checkout of this repo. In each place it links only when nothing is there or
// the link is one an earlier npm install of this tool left (an older Node,
// say); a folder, a file, or a link to anywhere else is left exactly as it is.
//
// The link points into the installed package, so updating the package updates
// the skill with no further step. It never fails the install: npm install
// --ignore-scripts skips it altogether. On Windows the link is a directory
// junction, which needs no admin rights.

const fs = require('fs');
const os = require('os');
const path = require('path');

// Folders whose presence says an assistant that reads ~/.agents/skills is set
// up on this machine.
const AGENT_HOMES = ['.agents', '.codex', '.gemini', '.copilot', '.cursor',
  path.join('.config', 'opencode'), path.join('.config', 'amp'), path.join('.config', 'goose')];

function places(home) {
  const out = [];
  const claude = process.env.CLAUDE_CONFIG_DIR || path.join(home, '.claude');
  if (fs.existsSync(claude)) out.push(path.join(claude, 'skills'));
  if (AGENT_HOMES.some((d) => fs.existsSync(path.join(home, d)))) out.push(path.join(home, '.agents', 'skills'));
  return out;
}

function main() {
  if (process.env.npm_config_global !== 'true') return;

  const pkg = require('../package.json');
  const id = Object.keys(pkg.bin || {})[0];
  if (!id) return;

  const source = path.resolve(__dirname, '..', 'agents', 'skills', id);
  if (!fs.existsSync(path.join(source, 'SKILL.md'))) return;

  for (const skills of places(os.homedir())) {
    try { link(source, skills, id); } catch (err) {
      say(`${id}: skill not linked into ${skills}: ${err.message}`);
    }
  }
}

function link(source, skills, id) {
  const dest = path.join(skills, id);
  let st = null;
  try { st = fs.lstatSync(dest); } catch { /* nothing there */ }

  if (st && !st.isSymbolicLink()) {
    say(`${id}: ${dest} is already there and not a link, so it was left alone. ` +
        `Remove it and install again to use the skill that comes with ${id}.`);
    return;
  }
  if (st) {
    const old = path.resolve(skills, fs.readlinkSync(dest));
    if (old === source) return;
    // A link of the person's own stays, even one whose folder has moved or is
    // not mounted right now. Only a link an earlier install of this tool left
    // (which can dangle once that install is gone) is replaced.
    if (!isOurs(old, id)) {
      say(`${id}: ${dest} links to ${old}, so it was left alone.`);
      return;
    }
    fs.unlinkSync(dest);
  }

  fs.mkdirSync(skills, { recursive: true });
  fs.symlinkSync(source, dest, process.platform === 'win32' ? 'junction' : 'dir');
  say(`${id}: linked its skill into ${dest}`);
}

// A link an earlier npm install of this same tool left behind.
function isOurs(target, id) {
  return target.split(path.sep).includes('node_modules') &&
    target.endsWith(path.join('agents', 'skills', id));
}

function say(line) { process.stderr.write(line + '\n'); }

try { main(); } catch (err) {
  say(`skill not linked: ${err.message}`);
}
