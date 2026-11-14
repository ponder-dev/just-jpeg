/*
 * The command-line contract (CONTRACT.md in the PonderDev tools workshop):
 * what every Just tool promises so a script, an assistant or the tool belt can
 * drive it without guessing.
 *
 *   node test/contract.test.mjs
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(here, '..', 'src', 'cli.mjs');
const FIX = path.join(here, 'fixtures');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'justjpeg-contract-'));
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));

function run(args, opts = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd: dir, timeout: 60000, ...opts });
  const lines = (r.stdout || '').split('\n').flatMap((l) => { try { const o = JSON.parse(l); return o && o.type ? [o] : []; } catch { return []; } });
  return { ...r, lines };
}

test('--help, --version and --describe answer first and do no work', () => {
  for (const flag of ['--help', '-V', '--describe']) {
    const before = fs.readdirSync(dir).length;
    // A bad option, a missing file and an open stdin pipe that never closes.
    const r = spawnSync(process.execPath, [CLI, '--no-such-option', 'missing.heic', flag], { cwd: dir, encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
    assert.equal(r.status, 0, `${flag}: ${r.stderr}`);
    assert.equal(fs.readdirSync(dir).length, before, `${flag} wrote nothing`);
  }
});

test('--describe is the shared schema and matches --help', () => {
  const d = JSON.parse(run(['--describe']).stdout);
  assert.equal(d.schema, 'ponderdev.cli-describe/1');
  assert.equal(d.command, 'justjpeg');
  assert.equal(d.network, false);
  const help = run(['--help']).stdout;
  for (const o of d.options) for (const f of o.flags) assert.ok(help.includes(f), `--help lists ${f}`);
  assert.deepEqual(d.exitCodes.map((e) => e.code), [0, 1, 2, 3, 129, 130, 143]);
});

test('usage errors exit 2, as JSON under --json, with a done line', () => {
  for (const args of [['--bogus'], ['x.heic', '--quality', '5'], ['missing.heic'], ['x.heic', '-o']]) {
    const r = run([...args, '--json']);
    assert.equal(r.status, 2, args.join(' '));
    assert.equal(r.lines[0].type, 'error');
    assert.equal(r.lines[0].code, 'usage');
    assert.equal(r.lines.at(-1).type, 'done');
    assert.equal(r.lines.at(-1).exit, 2);
  }
});

test('no input and an empty stdin is a usage error, not a wait', () => {
  const r = run(['--json'], { input: '' });
  assert.equal(r.status, 2);
  assert.equal(r.lines[0].code, 'usage');
});

test('some converted and some failed is exit 3; all failed is exit 1', () => {
  const mixed = path.join(dir, 'mixed');
  fs.mkdirSync(mixed);
  fs.copyFileSync(path.join(FIX, 'sample.png'), path.join(mixed, 'good.png'));
  fs.writeFileSync(path.join(mixed, 'bad.jpg'), 'not a picture');
  const r = run([mixed, '--json']);
  assert.equal(r.status, 3, r.stderr);
  assert.deepEqual(r.lines.map((l) => l.type).sort(), ['done', 'error', 'result']);

  const allBad = path.join(dir, 'bad');
  fs.mkdirSync(allBad);
  fs.writeFileSync(path.join(allBad, 'bad.jpg'), 'not a picture');
  assert.equal(run([allBad, '--json']).status, 1);
});

test('RAW and existing outputs are skips; --dry-run writes nothing', () => {
  const d = path.join(dir, 'skips');
  fs.mkdirSync(d);
  fs.copyFileSync(path.join(FIX, 'sample.png'), path.join(d, 'one.png'));
  fs.writeFileSync(path.join(d, 'shot.dng'), 'raw');
  const before = fs.readdirSync(d).sort();
  const dry = run([d, '--dry-run', '--json']);
  assert.equal(dry.status, 0, dry.stderr);
  assert.deepEqual(fs.readdirSync(d).sort(), before, 'dry run wrote nothing');
  assert.equal(dry.lines.find((l) => l.type === 'result').dryRun, true);
  const raw = dry.lines.find((l) => l.type === 'skip');
  assert.equal(raw.reason, 'raw');
});
