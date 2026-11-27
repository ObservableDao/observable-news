// Cross-run anti-replay and bundle transport (fixes 2 and 3).
// Every export, publish, acknowledgement and recovery below is a SEPARATE
// Node process started in a fresh, empty working directory, like an
// ephemeral GitHub-hosted runner. The only thing the runs share is the
// simulated GitHub release store (src/transport/fs-store.mjs), which models
// immutable releases: drafts have no tag, published assets are locked, and a
// used tag name can never be reused even after the release is deleted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsReleaseStore } from '../src/transport/fs-store.mjs';
import { tagFor, buildAcceptCheckpoint, encodeCheckpoint, GENESIS } from '../src/publish/checkpoint.mjs';
import { runPublish } from '../src/publish/gate.mjs';
import { makeKey, validContent } from './helpers.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const lastJSON = s => { const l = (s || '').trim().split('\n').filter(Boolean).at(-1); try { return JSON.parse(l); } catch { return null; } };

function world({ immutable = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'world-'));
  const storeDir = join(root, 'github');
  const store = new FsReleaseStore(storeDir, { immutableReleases: immutable });
  const desk = makeKey('desk-test'), cpk = makeKey('checkpoint-test');
  const deskTrust = join(root, 'desk-signers.json'); writeFileSync(deskTrust, JSON.stringify({ keys: [desk.entry] }));
  const cpTrust = join(root, 'checkpoint-signers.json'); writeFileSync(cpTrust, JSON.stringify({ keys: [cpk.entry] }));
  const content = join(root, 'content.json'); writeFileSync(content, JSON.stringify(validContent()));
  const spec = 'fs:' + storeDir;
  let runNo = 0;
  const spawn = (script, args, env) => {
    const cwd = mkdtempSync(join(tmpdir(), 'runner-')); // fresh ephemeral runner
    const r = spawnSync(process.execPath, [join(repo, script), ...args], { cwd, encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
    return { status: r.status, out: lastJSON(r.stdout) ?? lastJSON(r.stderr), stderr: r.stderr, leftovers: readdirSync(cwd) };
  };
  const w = {
    store, spec, desk, cpk, cpTrust, deskTrust,
    exportRun: ({ file = content, skipAdvisory } = {}) => spawn('test/support/export-cli.mjs',
      [file, '--store', spec, '--checkpoint-signers', cpTrust, ...(skipAdvisory ? ['--skip-advisory', '1'] : [])],
      { DESK_SIGNING_KEY: desk.pem, DESK_KEY_ID: 'desk-test' }),
    publishRun: () => spawn('scripts/publish-run.mjs', ['--store', spec, '--desk-signers', deskTrust, '--checkpoint-signers', cpTrust],
      { CHECKPOINT_SIGNING_KEY: cpk.pem, CHECKPOINT_KEY_ID: 'checkpoint-test', GITHUB_RUN_ID: String(++runNo) }),
    ackRun: (seq, sha) => spawn('scripts/check-ack.mjs', ['--store', spec, '--sequence', String(seq), '--bundle-sha', sha, '--checkpoint-signers', cpTrust], {}),
    recoverRun: (reason, base) => spawn('scripts/recover-skip.mjs', ['--store', spec, '--reason', reason, '--expect-base', String(base), '--checkpoint-signers', cpTrust],
      { CHECKPOINT_SIGNING_KEY: cpk.pem, CHECKPOINT_KEY_ID: 'checkpoint-test', GITHUB_RUN_ID: 'recover' }),
  };
  w.publishOne = () => {
    const e = w.exportRun(); assert.equal(e.status, 0, e.stderr);
    const p = w.publishRun(); assert.equal(p.out.status, 'accepted', JSON.stringify(p.out));
    return { e, p };
  };
  return w;
}

const published = async (store, tag) => (await store.list()).find(r => r.tag === tag && !r.draft);
// Attacker holding the dispatch token (Contents: write): copy genuine assets into a new draft.
async function replayAsDraft(store, fromTag, toTag, extra = {}) {
  const src = await published(store, fromTag);
  const id = await store.createDraft(toTag);
  for (const n of ['bundle.json', 'manifest.json', 'signature.txt']) await store.upload(id, n, await store.download(src.id, n));
  for (const [n, b] of Object.entries(extra)) await store.upload(id, n, b);
  return id;
}

test('X1 upload, discovery, validation and acknowledgement across independent runs', async () => {
  const w = world();
  const e1 = w.exportRun();
  assert.equal(e1.status, 0, e1.stderr); assert.equal(e1.out.sequence, 1);
  assert.equal(w.ackRun(1, e1.out.bundleSha256).out.state, 'pending');
  const p1 = w.publishRun();
  assert.deepEqual([p1.status, p1.out.status, p1.out.sequence], [0, 'accepted', 1]);
  const a1 = w.ackRun(1, e1.out.bundleSha256);
  assert.deepEqual([a1.status, a1.out.state], [0, 'acknowledged']);
  const e2 = w.exportRun(); assert.equal(e2.out.sequence, 2, 'next export reads the new head');
  assert.equal(w.publishRun().out.sequence, 2);
  assert.equal(w.ackRun(2, e2.out.bundleSha256).out.state, 'acknowledged');
  assert.equal(w.ackRun(2, 'f'.repeat(64)).out.state, 'mismatch');
  const idle = w.publishRun(); assert.deepEqual([idle.status, idle.out.status, idle.out.head], [0, 'nothing-to-do', 2]);
  for (const t of [tagFor(1), tagFor(2)]) assert.equal((await published(w.store, t)).immutable, true);
  for (const r of [e1, p1, a1, e2, idle]) assert.deepEqual(r.leftovers, [], 'runs keep no local state');
});

test('X2 replay of accepted bundles in later runs is rejected', async () => {
  const w = world(); w.publishOne(); w.publishOne();
  await replayAsDraft(w.store, tagFor(1), tagFor(3));
  const r1 = w.publishRun();
  assert.deepEqual([r1.status, r1.out.status, r1.out.reason], [1, 'rejected', 'replay-or-rollback']);
  await replayAsDraft(w.store, tagFor(2), tagFor(3));
  assert.equal(w.publishRun().out.reason, 'replay-or-rollback');
  assert.equal((await w.store.list()).filter(r => r.draft).length, 0, 'rejected drafts are removed');
  const id = await replayAsDraft(w.store, tagFor(1), tagFor(1));
  await assert.rejects(w.store.publish(id), { code: 'tag-already-used' });
  assert.equal(w.publishRun().out.head, 2);
});

test('X3 rollback by deleting the newest publication is blocked and needs a signed skip', async () => {
  const w = world(); w.publishOne(); w.publishOne(); w.publishOne();
  const saved = {}; const p3 = await published(w.store, tagFor(3));
  for (const n of ['bundle.json', 'manifest.json', 'signature.txt']) saved[n] = await w.store.download(p3.id, n);
  await w.store.remove(p3.id);                                   // attacker deletes the head release
  const id = await w.store.createDraft(tagFor(3));               // ...and re-offers the genuine bundle 3
  for (const [n, b] of Object.entries(saved)) await w.store.upload(id, n, b);
  const r = w.publishRun();
  assert.deepEqual([r.status, r.out.status, r.out.reason, r.out.at], [2, 'halted', 'sequence-already-used', 3]);
  assert.equal(await published(w.store, tagFor(3)), undefined, 'nothing was re-published');
  assert.equal(w.exportRun().out.sequence, 3);
  assert.equal(w.publishRun().out.reason, 'sequence-already-used', 'still halted: sequence 3 can never be reopened');
  const wrong = w.recoverRun('deleted-release', 1);
  assert.deepEqual([wrong.status, wrong.out.reason], [2, 'base-not-confirmed']);
  const ok = w.recoverRun('deleted-release', 2);
  assert.deepEqual([ok.status, ok.out.status, ok.out.base, ok.out.sequence], [0, 'skipped', 2, 4]);
  const id5 = await w.store.createDraft(tagFor(5));
  for (const [n, b] of Object.entries(saved)) await w.store.upload(id5, n, b);
  assert.equal(w.publishRun().out.reason, 'replay-or-rollback', 'old bundle cannot be replayed after the skip');
  const e = w.exportRun(); assert.equal(e.out.sequence, 5);
  assert.equal(w.publishRun().out.status, 'accepted');
});

test('X4 a forged publication halts publishing and exporting until a signed skip', async () => {
  const w = world(); w.publishOne();
  const attacker = makeKey('checkpoint-test');
  const fake = buildAcceptCheckpoint({ sequence: 2, prev: { sequence: 1, checkpointSha256: '0'.repeat(64) },
    bundleBytes: Buffer.from('x'), manifestBytes: Buffer.from('y'), signatureBytes: Buffer.from('z'),
    deskKeyId: 'desk-test', createdAt: new Date().toISOString(), runId: 'evil', keyId: 'checkpoint-test' });
  const enc = encodeCheckpoint(fake, attacker.privateKey);
  const id = await replayAsDraft(w.store, tagFor(1), tagFor(2), { 'checkpoint.json': enc.json, 'checkpoint.sig': enc.sig });
  await w.store.publish(id);
  const r = w.publishRun();
  assert.deepEqual([r.status, r.out.status, r.out.reason], [2, 'halted', 'checkpoint-signature-invalid']);
  const e = w.exportRun();
  assert.deepEqual([e.status, e.out.reason], [3, 'public-state-halted']);
  assert.equal(w.recoverRun('forged-release', 1).out.sequence, 3);
  assert.equal(w.exportRun().out.sequence, 4);
  assert.equal(w.publishRun().out.status, 'accepted');
});

test('X5 content-invalid bundle signed with the genuine desk key is rejected (private CI skipped)', async () => {
  const w = world();
  const bad = validContent(); delete bad.stories[0].sources[0].permission;
  const file = join(mkdtempSync(join(tmpdir(), 'bad-')), 'bad.json'); writeFileSync(file, JSON.stringify(bad));
  assert.equal(w.exportRun({ file }).status, 1, 'advisory check blocks it on the desk');
  assert.equal(w.exportRun({ file, skipAdvisory: true }).status, 0, 'but a skipped check still uploads it');
  const r = w.publishRun();
  assert.deepEqual([r.status, r.out.stage, r.out.reason], [1, 'content', 'content-invalid']);
  assert.ok(r.out.errors.includes('required:$.stories[0].sources[0].permission'));
  assert.equal(w.publishOne().p.out.sequence, 1, 'a corrected export then succeeds');
});

test('X6 publishing fails closed when release immutability is off', () => {
  const w = world({ immutable: false });
  assert.equal(w.exportRun().status, 0);
  const r = w.publishRun();
  assert.deepEqual([r.status, r.out.stage, r.out.reason], [2, 'post-publish', 'not-immutable']);
  assert.deepEqual([w.publishRun().out.stage, w.publishRun().out.reason], ['state', 'not-immutable']);
});

test('X7 an asset swapped between validation and publishing is caught', async () => {
  const w = world();
  assert.equal(w.exportRun().status, 0);
  const inner = w.store;
  const swapping = { // attacker swaps the bundle in the draft at the last moment
    list: () => inner.list(), download: (i, n) => inner.download(i, n), upload: (i, n, b) => inner.upload(i, n, b), remove: i => inner.remove(i),
    publish: async id => { await inner.deleteAsset(id, 'bundle.json'); await inner.upload(id, 'bundle.json', Buffer.from('{"evil":true}')); return inner.publish(id); },
  };
  const r = await runPublish({ store: swapping, deskTrust: [w.desk.entry], checkpointTrust: [w.cpk.entry], checkpointKey: w.cpk.privateKey, checkpointKeyId: 'checkpoint-test', runId: 't' });
  assert.deepEqual([r.status, r.stage, r.reason], ['halted', 'post-publish', 'asset-hash-mismatch']);
  const next = w.publishRun();
  assert.deepEqual([next.status, next.out.reason], [2, 'asset-hash-mismatch'], 'every later run stays halted');
});

test('X8 ambiguous drafts and unexpected assets are rejected', async () => {
  const w = world(); w.publishOne();
  await replayAsDraft(w.store, tagFor(1), tagFor(2)); await replayAsDraft(w.store, tagFor(1), tagFor(2));
  assert.equal(w.publishRun().out.reason, 'ambiguous-drafts');
  await replayAsDraft(w.store, tagFor(1), tagFor(2), { 'extra.js': Buffer.from('x') });
  assert.equal(w.publishRun().out.reason, 'unexpected-assets');
  assert.equal((await w.store.list()).filter(r => r.draft).length, 0);
});

test('X9 simulator model check: documented immutable-release rules', async () => {
  const s = new FsReleaseStore(mkdtempSync(join(tmpdir(), 'model-')));
  const d = await s.createDraft('pub-00000009'); await s.remove(d);                  // drafts do not burn tags
  const id = await s.createDraft('pub-00000009'); await s.upload(id, 'a.txt', Buffer.from('1')); await s.publish(id);
  await assert.rejects(s.upload(id, 'b.txt', Buffer.from('2')), { code: 'asset-locked' });
  await assert.rejects(s.deleteAsset(id, 'a.txt'), { code: 'asset-locked' });
  await s.remove(id);                                                                // deletion is possible...
  const again = await s.createDraft('pub-00000009');
  await assert.rejects(s.publish(again), { code: 'tag-already-used' });              // ...but the tag is burned
  assert.equal(GENESIS.sequence, 0);
});
