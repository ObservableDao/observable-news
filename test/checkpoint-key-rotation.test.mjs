// Checkpoint signing-key rotation (independent review).
// Ordinary retirement uses notAfter: a retired key can no longer sign, but every
// checkpoint it signed while valid stays valid forever. The clock is controlled,
// so the runs below span six months.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsReleaseStore } from '../src/transport/fs-store.mjs';
import { readHead } from '../src/publish/checkpoint.mjs';
import { runPublish } from '../src/publish/gate.mjs';
import { exportBundle } from '../src/publish/export.mjs';
import { makeKey, validContent, bytesOf } from './helpers.mjs';

const T0 = Date.parse('2026-11-28T09:00:00Z');
const RETIRE = '2027-05-01T00:00:00Z';
const AFTER = Date.parse('2027-05-02T09:00:00Z');
const LATER = Date.parse('2028-01-01T00:00:00Z');

function setup() {
  const store = new FsReleaseStore(mkdtempSync(join(tmpdir(), 'rot-')));
  const desk = makeKey('desk-rot');
  const oldKey = makeKey('cp-2026', { notBefore: '2026-01-01T00:00:00Z', notAfter: RETIRE });
  const newKey = makeKey('cp-2027', { notBefore: '2027-04-24T00:00:00Z', notAfter: '2027-11-01T00:00:00Z' });
  const trust = [oldKey.entry, newKey.entry];
  const exp = now => exportBundle({ store, checkpointTrust: trust, bundleBytes: bytesOf(validContent()), sourceCommit: 'c'.repeat(40), deskKey: desk.privateKey, deskKeyId: 'desk-rot', now });
  const pub = (key, now, t = trust) => runPublish({ store, deskTrust: [desk.entry], checkpointTrust: t, checkpointKey: key.privateKey, checkpointKeyId: key.entry.keyId, runId: 'r', now });
  return { store, oldKey, newKey, trust, exp, pub };
}

test('K1 retiring a key keeps its historical checkpoints valid across the rotation', async () => {
  const w = setup();
  for (let i = 0; i < 2; i++) { assert.equal((await w.exp(T0 + i)).ok, true); assert.equal((await w.pub(w.oldKey, T0 + i)).status, 'accepted'); }
  const e = await w.exp(AFTER);                      // the desk reads the old-key head after retirement
  assert.deepEqual([e.ok, e.sequence], [true, 3]);
  assert.equal((await w.pub(w.newKey, AFTER)).status, 'accepted');
  assert.equal((await w.exp(AFTER + 1)).sequence, 4);
  assert.equal((await w.pub(w.newKey, AFTER + 1)).status, 'accepted');
  const audit = await readHead(w.store, w.trust, { depth: Infinity, now: LATER }); // both keys now retired
  assert.deepEqual([audit.ok, audit.head.sequence, audit.verified], [true, 4, [4, 3, 2, 1]]);
});

test('K2 a run still using the retired key stops before consuming a sequence', async () => {
  const w = setup();
  await w.exp(T0); await w.pub(w.oldKey, T0);
  await w.exp(AFTER);
  const r = await w.pub(w.oldKey, AFTER);
  assert.deepEqual([r.status, r.stage, r.reason, r.detail], ['halted', 'signing', 'checkpoint-key-not-valid', 'key-expired']);
  assert.ok((await w.store.list()).some(x => x.draft && x.tag === 'pub-00000002'), 'draft still waiting, sequence 2 not burned');
  assert.equal((await w.pub(w.newKey, AFTER)).sequence, 2, 'the new key then publishes the same draft');
});

test('K3 a new key cannot sign before its start date', async () => {
  const w = setup();
  await w.exp(T0);
  const r = await w.pub(w.newKey, T0);
  assert.deepEqual([r.reason, r.detail], ['checkpoint-key-not-valid', 'key-not-yet-valid']);
  assert.equal((await w.pub(w.oldKey, T0)).status, 'accepted');
});

test('K4 during the overlap week either key may sign, and the mixed chain verifies', async () => {
  const w = setup();
  const overlap = Date.parse('2027-04-27T09:00:00Z');
  await w.exp(overlap); assert.equal((await w.pub(w.newKey, overlap)).status, 'accepted');
  await w.exp(overlap + 1); assert.equal((await w.pub(w.oldKey, overlap + 1)).status, 'accepted');
  const audit = await readHead(w.store, w.trust, { depth: Infinity, now: LATER });
  assert.deepEqual([audit.ok, audit.verified], [true, [2, 1]]);
});

test('K5 deleting a retired key from the trust store breaks history (keep retired keys listed)', async () => {
  const w = setup();
  await w.exp(T0); await w.pub(w.oldKey, T0);
  await w.exp(AFTER); await w.pub(w.newKey, AFTER);
  const st = await readHead(w.store, [w.newKey.entry], { depth: Infinity, now: AFTER });
  assert.deepEqual([st.ok, st.problems[0].sequence, st.problems[0].problem], [false, 1, 'checkpoint-unknown-key']);
});

test('K6 revoking a key (compromise) invalidates its checkpoints and halts publishing', async () => {
  const w = setup();
  await w.exp(T0); await w.pub(w.oldKey, T0);
  const revoked = [{ ...w.oldKey.entry, revokedAt: '2026-12-01T00:00:00Z' }, w.newKey.entry];
  await w.exp(T0 + 1);
  const r = await w.pub(w.newKey, AFTER, revoked);
  assert.deepEqual([r.status, r.reason], ['halted', 'checkpoint-key-revoked']);
});
