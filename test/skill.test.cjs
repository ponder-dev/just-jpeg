'use strict';
// The tool ships its own agent skill (RELEASING.md step 6, CONTRACT.md
// section 10 in the PonderDev tools workshop): it is in the package, it names
// itself after the command, and a global npm install links it into Claude Code
// and the shared ~/.agents/skills without touching anything that is not its own.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const id = Object.keys(pkg.bin)[0];
const skillDir = path.join(root, 'agents', 'skills', id);
const linker = path.join(root, 'scripts', 'link-skill.cjs');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (err) {
    console.error(`FAIL ${name}\n${err.stack}`);
    process.exitCode = 1;
  }
}

test('the skill exists and is named after the command', () => {
  // A Windows checkout turns the line endings into CRLF.
  const md = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
  const front = md.match(/^---\n([\s\S]*?)\n---\n/);
  assert(front, 'SKILL.md starts with frontmatter');
  assert.match(front[1], new RegExp(`^name: ${id}$`, 'm'));
  assert.match(front[1], /^description: .{80,}$/m);
  assert(!md.includes('\u2014'), 'no em dashes');
});

test('the package carries the skill and the linker, and runs it on install', () => {
  assert(pkg.files.includes('agents/**/*'));
  assert(pkg.files.includes('scripts/link-skill.cjs'));
  assert.strictEqual(pkg.scripts.postinstall, 'node scripts/link-skill.cjs');
});

test('the Windows and Linux installers make the icon first, and the release runs every test', () => {
  for (const script of ['dist:win', 'dist:linux']) {
    assert(/icon:ensure/.test(pkg.scripts[script]), `${script} makes build/icon.png when it is missing`);
  }
  const wf = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');
  for (const t of ['cli.test.mjs', 'skill.test.cjs', 'pixels.test.mjs', 'tiff.test.mjs', 'licences.test.mjs']) {
    assert(wf.includes(t), `release.yml runs ${t}`);
  }
});

function run(env) {
  return execFileSync(process.execPath, [linker], {
    env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
}

test('a global install links the skill; a local one does nothing', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-'));
  const claude = path.join(home, '.claude');
  fs.mkdirSync(claude);
  const dest = path.join(claude, 'skills', id);
  try {
    run({ HOME: home, USERPROFILE: home, npm_config_global: 'false' });
    assert(!fs.existsSync(dest), 'local install leaves Claude alone');
    run({ HOME: home, USERPROFILE: home, npm_config_global: 'true' });
    assert.strictEqual(fs.realpathSync(dest), fs.realpathSync(skillDir));
    run({ HOME: home, USERPROFILE: home, npm_config_global: 'true' });
    assert.strictEqual(fs.realpathSync(dest), fs.realpathSync(skillDir), 'again is a no-op');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('someone else\'s folder or link is left alone; no Claude, no link', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-'));
  const skills = path.join(home, '.claude', 'skills');
  const dest = path.join(skills, id);
  const env = { HOME: home, USERPROFILE: home, npm_config_global: 'true' };
  try {
    run(env);
    assert(!fs.existsSync(path.join(home, '.claude')), 'no ~/.claude, nothing made');
    fs.mkdirSync(dest, { recursive: true });
    run(env);
    assert(!fs.lstatSync(dest).isSymbolicLink(), 'a real folder stays');
    fs.rmdirSync(dest);
    const other = path.join(home, 'mine');
    fs.mkdirSync(other);
    fs.symlinkSync(other, dest, process.platform === 'win32' ? 'junction' : 'dir');
    run(env);
    assert.strictEqual(fs.realpathSync(dest), fs.realpathSync(other), 'a link elsewhere stays');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('a link of the person\'s own is left alone even when it dangles; an earlier install\'s dangling link is replaced', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-'));
  const skills = path.join(home, '.claude', 'skills');
  const dest = path.join(skills, id);
  const env = { HOME: home, USERPROFILE: home, npm_config_global: 'true' };
  const type = process.platform === 'win32' ? 'junction' : 'dir';
  try {
    fs.mkdirSync(skills, { recursive: true });
    // Mine, to a checkout that is not mounted right now.
    const gone = path.join(home, 'unmounted', 'my-skills', id);
    fs.symlinkSync(gone, dest, type);
    run(env);
    assert.strictEqual(path.resolve(skills, fs.readlinkSync(dest)), gone, 'a dangling link of the person\'s stays');
    // An older npm install of this tool, since removed.
    fs.unlinkSync(dest);
    const old = path.join(home, 'lib', 'node_modules', '@ponderdev', id, 'agents', 'skills', id);
    fs.symlinkSync(old, dest, type);
    run(env);
    assert.strictEqual(fs.realpathSync(dest), fs.realpathSync(skillDir), 'a dangling link from an earlier install is replaced');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('the shared ~/.agents/skills folder gets a link too, only where an assistant reads it', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-'));
  const env = { HOME: home, USERPROFILE: home, npm_config_global: 'true' };
  const shared = path.join(home, '.agents', 'skills', id);
  try {
    run(env);
    assert(!fs.existsSync(path.join(home, '.agents')), 'no assistant here, no ~/.agents made');
    // Codex is set up: the shared folder is made and linked, Claude's is not.
    fs.mkdirSync(path.join(home, '.codex'));
    run(env);
    assert.strictEqual(fs.realpathSync(shared), fs.realpathSync(skillDir));
    assert(!fs.existsSync(path.join(home, '.claude')));
    // With Claude as well, both are linked, and someone's own folder in the
    // shared place is still left alone.
    fs.mkdirSync(path.join(home, '.claude'));
    fs.unlinkSync(shared);
    fs.mkdirSync(shared);
    run(env);
    assert.strictEqual(fs.realpathSync(path.join(home, '.claude', 'skills', id)), fs.realpathSync(skillDir));
    assert(!fs.lstatSync(shared).isSymbolicLink(), 'a real folder stays');
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('CLAUDE_CONFIG_DIR moves the Claude link', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-'));
  const cfg = path.join(home, 'cfg');
  fs.mkdirSync(cfg);
  fs.mkdirSync(path.join(home, '.claude'));
  try {
    run({ HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: cfg, npm_config_global: 'true' });
    assert.strictEqual(fs.realpathSync(path.join(cfg, 'skills', id)), fs.realpathSync(skillDir));
    assert(!fs.existsSync(path.join(home, '.claude', 'skills')));
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

console.log(`skill: ${passed} passed`);
