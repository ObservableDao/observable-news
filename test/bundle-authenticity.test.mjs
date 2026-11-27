// M0 security acceptance test C: approved-bundle authenticity (plus A12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptBundle } from '../src/bundle/accept.mjs';
import { buildManifest, sha256Hex, canonicalJSON } from '../src/bundle/signature.mjs';
import { makeKey, signedBundle, sampleContent, NOW, COMMIT } from './helpers.mjs';

const desk = makeKey('desk-2026-11');
const trustStore = [desk.entry];
const gate = (b, extra = {}) => acceptBundle({ ...b, trustStore, lastAcceptedSequence: 5, now: NOW, ...extra });

test('C0 control: a genuine signed bundle is accepted', () => {
  const r = gate(signedBundle(sampleContent(), desk));
  assert.equal(r.ok, true);
});

test('C1 forged bundle with a valid SHA-256 but no signature is rejected', () => {
  const forged = Buffer.from(canonicalJSON(sampleContent({ corrections: [{ target: 's1', text: 'forged' }] })));
  const manifest = buildManifest({ bundleBytes: forged, sequence: 11, sourceCommit: COMMIT, createdAt: '2026-11-28T08:00:00Z', keyId: 'desk-2026-11' });
  assert.equal(manifest.sha256, sha256Hex(forged)); // checksum is valid...
  const r = gate({ bundleBytes: forged, manifest, signature: '' });
  assert.equal(r.ok, false); assert.equal(r.reason, 'signature-missing');
});

test('C2 bundle signed by an attacker key (unknown or impersonating key id) is rejected', () => {
  const attacker = makeKey('desk-2026-11'); // same key id, different key
  const r = gate(signedBundle(sampleContent(), attacker));
  assert.equal(r.ok, false); assert.equal(r.reason, 'signature-invalid');
  const other = makeKey('someone-else');
  assert.equal(gate(signedBundle(sampleContent(), other)).reason, 'unknown-key');
});

test('C3 substituted content under a genuine signature is rejected', () => {
  const genuine = signedBundle(sampleContent(), desk);
  const substitute = Buffer.from(canonicalJSON(sampleContent({ corrections: [{ target: 's1', text: 'substituted' }] })));
  const r = gate({ ...genuine, bundleBytes: substitute });
  assert.equal(r.ok, false); assert.ok(['hash-mismatch', 'size-mismatch'].includes(r.reason));
});

test('C4 substituted manifest (attacker edits the hash to match their bundle) is rejected', () => {
  const genuine = signedBundle(sampleContent(), desk);
  const substitute = Buffer.from(canonicalJSON(sampleContent({ corrections: [{ target: 's1', text: 'x' }] })));
  const manifest = { ...genuine.manifest, sha256: sha256Hex(substitute), size: substitute.length };
  const r = gate({ bundleBytes: substitute, manifest, signature: genuine.signature });
  assert.equal(r.ok, false); assert.equal(r.reason, 'signature-invalid');
});

test('C5 replay of an older genuine bundle (rollback) is rejected', () => {
  const old = signedBundle(sampleContent(), desk, { sequence: 5 });
  assert.equal(gate(old).reason, 'replay-or-rollback');
  const older = signedBundle(sampleContent(), desk, { sequence: 3 });
  assert.equal(gate(older).reason, 'replay-or-rollback');
});

test('C6 genuine signature over forbidden private fields is still rejected by the content gate', () => {
  const leaky = signedBundle(sampleContent({ controls: { hidden: [{ target: 'item:1', reason: 'private reason' }] } }), desk, { sequence: 12 });
  const r = gate(leaky);
  assert.equal(r.ok, false); assert.equal(r.stage, 'content');
});

test('C7 revoked and expired keys are rejected; a rotated key is accepted', () => {
  const revoked = makeKey('desk-old', { revokedAt: '2026-11-20T00:00:00Z' });
  const expired = makeKey('desk-exp', { notAfter: '2026-10-01T00:00:00Z' });
  const rotated = makeKey('desk-new', { notBefore: '2026-11-15T00:00:00Z' });
  const store = [revoked.entry, expired.entry, rotated.entry];
  const run = k => acceptBundle({ ...signedBundle(sampleContent(), k, { sequence: 20 }), trustStore: store, lastAcceptedSequence: 5, now: NOW });
  assert.equal(run(revoked).reason, 'key-revoked');
  assert.equal(run(expired).reason, 'key-expired');
  assert.equal(run(rotated).ok, true);
});

test('C8 future-dated and stale bundles are rejected', () => {
  assert.equal(gate(signedBundle(sampleContent(), desk, { sequence: 30, createdAt: '2026-11-29T09:00:00Z' })).reason, 'created-in-future');
  assert.equal(gate(signedBundle(sampleContent(), desk, { sequence: 31, createdAt: '2026-09-01T09:00:00Z' })).reason, 'bundle-too-old');
});

test('A12 unreviewed AI badge and draft field are rejected even with a valid signature', () => {
  const bad = sampleContent({
    classifications: [{ claim: 'x', level: 'demonstrated', badgeText: 'Verified by Observable', evidence: [] }],
    stories: [{ slug: 'd', status: 'draft', draft: true, headline: 'x', sources: [] }],
  });
  const r = gate(signedBundle(bad, desk, { sequence: 40 }));
  assert.equal(r.ok, false); assert.equal(r.stage, 'content');
  for (const e of ['forbidden-field', 'story-not-approved', 'classification-without-evidence', 'classification-unreviewed', 'classification-says-verified']) {
    assert.ok(r.reason.includes(e), `expected ${e}`);
  }
});
