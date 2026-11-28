// Leftover-R2 / metered-binding scan and workflow lint, with positive controls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, copyFileSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const run = (script, ...a) => spawnSync(process.execPath, [join(repo, 'scripts', script), ...a], { encoding: 'utf8' });

test('no R2 or other metered Cloudflare dependency in active files of this repository', () => {
  const r = run('check-forbidden.mjs', repo, '--json');
  assert.deepEqual(JSON.parse(r.stdout).findings, []);
  assert.equal(r.status, 0);
});

test('positive control: the scan catches an R2 binding and a retired bucket name', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'scan-'));
  copyFileSync(join(repo, 'test/fixtures/r2-positive-control/wrangler.toml'), join(tmp, 'wrangler.toml'));
  const r = run('check-forbidden.mjs', tmp, '--json');
  const rules = JSON.parse(r.stdout).findings.map(f => f.rule);
  assert.equal(r.status, 1);
  assert.ok(rules.includes('R2 binding') && rules.includes('retired R2 bucket name'));
});

const desk = join(repo, '..', 'observable-news-desk');
const wfDirs = [join(repo, '.github/workflows'), join(repo, 'proposed-workflows'), join(desk, '.github/workflows'), join(desk, 'proposed-workflows')];

test('strict workflow lint: every action in both repositories is pinned to its verified SHA', () => {
  const r = run('check-workflows.mjs', ...wfDirs);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, / 0 problem\(s\)/);
});

test('positive control: the strict lint rejects a tag, an unverified SHA and an unknown action', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'pin-'));
  writeFileSync(join(tmp, 'x.yml'), 'on: push\npermissions:\n  contents: read\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v6\n      - uses: actions/checkout@' + '0'.repeat(40) + '\n      - uses: someone/action@' + '1'.repeat(40) + '\n');
  const r = run('check-workflows.mjs', tmp);
  assert.equal(r.status, 1);
  for (const s of ['not pinned to a full commit SHA', 'unverified SHA', 'not in the pin list']) assert.ok(r.stdout.includes(s), s);
});

test('positive control: the lint rejects an unquoted value containing ": " (invalid YAML)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'yaml-'));
  writeFileSync(join(tmp, 'x.yml'), 'on: push\npermissions:\n  contents: read\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - name: Lint (strict: pinned)\n        run: echo hi\n');
  const r = run('check-workflows.mjs', tmp);
  assert.equal(r.status, 1);
  assert.ok(r.stdout.includes('invalid YAML'), r.stdout);
});

test('only CI and the read-only benchmark are active; nothing uses the old state file or shared release', () => {
  assert.deepEqual(readdirSync(join(repo, '.github/workflows')).sort(), ['benchmark.yml', 'ci.yml']);
  const bench = readFileSync(join(repo, '.github/workflows/benchmark.yml'), 'utf8');
  assert.ok(!/secrets\./.test(bench), 'benchmark uses no secrets');
  assert.ok(!/:\s*write\b/.test(bench), 'benchmark has no write permission');
  assert.ok(!/^\s*schedule:/m.test(bench), 'benchmark has no schedule');
  if (existsSync(desk)) assert.deepEqual(readdirSync(join(desk, '.github/workflows')), ['ci.yml']);
  for (const d of wfDirs) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) {
      const t = readFileSync(join(d, f), 'utf8');
      assert.ok(!/desk-bundles|state\/last-bundle|accept-bundle\.mjs|gh release upload/.test(t), `${f} still uses the old transport`);
    }
  }
});

test('positive control: the lint catches pull_request_target and secrets in a PR workflow', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'wf-'));
  writeFileSync(join(tmp, 'bad.yml'), 'on:\n  pull_request_target:\n  pull_request:\npermissions: write-all\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ${{ secrets.TOKEN }}\n');
  const r = run('check-workflows.mjs', tmp, '--allow-unpinned');
  assert.equal(r.status, 1);
  for (const s of ['pull_request_target', 'write-all', 'references secrets']) assert.ok(r.stdout.includes(s), s);
});
