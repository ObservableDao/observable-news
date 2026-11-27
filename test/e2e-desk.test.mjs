// End-to-end with the REAL desk CLI (observable-news-desk/scripts/export.mjs),
// each step a separate process. Skipped if the desk repository is not next to this one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsReleaseStore } from '../src/transport/fs-store.mjs';
import { tagFor } from '../src/publish/checkpoint.mjs';
import { makeKey } from './helpers.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const desk = join(repo, '..', 'observable-news-desk');
const last = s => JSON.parse(s.trim().split('\n').at(-1));

test('desk export CLI -> public publish run -> acknowledgement; a substituted bundle is rejected', { skip: !existsSync(desk) && 'desk repo not present' }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'e2e-'));
  const store = new FsReleaseStore(join(root, 'gh'));
  const dk = makeKey('desk-e2e'), ck = makeKey('cp-e2e');
  const dt = join(root, 'd.json'), ct = join(root, 'c.json');
  writeFileSync(dt, JSON.stringify({ keys: [dk.entry] })); writeFileSync(ct, JSON.stringify({ keys: [ck.entry] }));
  const run = (cwdRepo, script, args, env) => {
    const cwd = mkdtempSync(join(tmpdir(), 'runner-'));
    const r = spawnSync(process.execPath, [join(cwdRepo, script), ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
    assert.deepEqual(readdirSync(cwd), []);
    return r;
  };
  const exp = () => run(desk, 'scripts/export.mjs', [join(desk, 'content/sample-approved.json'), 'b'.repeat(40), '--store', 'fs:' + join(root, 'gh')],
    { DESK_SIGNING_KEY: dk.pem, DESK_KEY_ID: 'desk-e2e', PUBLIC_REPO_DIR: repo, CHECKPOINT_SIGNERS: ct });
  const pub = () => run(repo, 'scripts/publish-run.mjs', ['--store', 'fs:' + join(root, 'gh'), '--desk-signers', dt, '--checkpoint-signers', ct],
    { CHECKPOINT_SIGNING_KEY: ck.pem, CHECKPOINT_KEY_ID: 'cp-e2e', GITHUB_RUN_ID: '1' });

  const e = exp();
  assert.equal(e.status, 0, e.stderr);
  assert.ok(!e.stdout.includes('SAMPLE CONTENT'), 'export log must not contain content');
  const ex = last(e.stdout);
  assert.equal(last(pub().stdout).status, 'accepted');
  const ack = run(repo, 'scripts/check-ack.mjs', ['--store', 'fs:' + join(root, 'gh'), '--sequence', '1', '--bundle-sha', ex.bundleSha256, '--checkpoint-signers', ct], {});
  assert.equal(last(ack.stdout).state, 'acknowledged');

  assert.equal(exp().status, 0);
  const draft = (await store.list()).find(r => r.draft && r.tag === tagFor(2));
  await store.deleteAsset(draft.id, 'bundle.json');
  await store.upload(draft.id, 'bundle.json', Buffer.from('{"schemaVersion":1,"substituted":true}'));
  const p = pub();
  assert.equal(p.status, 1);
  assert.ok(['hash-mismatch', 'size-mismatch'].includes(last(p.stdout).reason), p.stdout);
});
