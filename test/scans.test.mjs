// Leftover-R2 / metered-binding scan and workflow lint, with positive controls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
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

test('workflow lint: active and proposed workflows have no security problems (SHA pinning reported separately)', () => {
  const r = run('check-workflows.mjs', join(repo, '.github/workflows'), join(repo, 'proposed-workflows'), '--allow-unpinned');
  assert.equal(r.status, 0, r.stdout);
});

test('positive control: the lint catches pull_request_target and secrets in a PR workflow', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'wf-'));
  writeFileSync(join(tmp, 'bad.yml'), 'on:\n  pull_request_target:\n  pull_request:\npermissions: write-all\njobs:\n  x:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ${{ secrets.TOKEN }}\n');
  const r = run('check-workflows.mjs', tmp, '--allow-unpinned');
  assert.equal(r.status, 1);
  for (const s of ['pull_request_target', 'write-all', 'references secrets']) assert.ok(r.stdout.includes(s), s);
});
