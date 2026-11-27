// M0 security acceptance test C: approved-bundle authenticity (plus A12).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptBundle } from '../src/bundle/accept.mjs';
import { buildManifest, sha256Hex } from '../src/bundle/signature.mjs';
import { makeKey, signedBundle, validContent, bytesOf, NOW, COMMIT } from './helpers.mjs';

const desk = makeKey('desk-2026-11');
const trustStore = [desk.entry];
const HEAD = { sequence: 5, checkpointSha256: 'c'.repeat(64) };
const expected = { sequence: 6, basedOn: HEAD };
const opts = { sequence: 6, basedOn: HEAD };
const gate = (b, extra = {}) => acceptBundle({ ...b, trustStore, expected, now: NOW, ...extra });
const altered = () => { const c = validContent(); c.corrections.push({ id: 'fake-correction', targetId: 'sample-story-not-real-news', kind: 'correction', text: 'forged', correctedAt: '2026-11-28T08:00:00Z' }); return c; };

test('C0 control: a genuine signed bundle built on the current head is accepted', () => {
  assert.equal(gate(signedBundle(validContent(), desk, opts)).ok, true);
});

test('C1 forged bundle with a valid SHA-256 but no signature is rejected', () => {
  const forged = bytesOf(altered());
  const manifest = buildManifest({ bundleBytes: forged, ...opts, sourceCommit: COMMIT, createdAt: '2026-11-28T08:00:00Z', keyId: 'desk-2026-11' });
  assert.equal(manifest.sha256, sha256Hex(forged)); // the checksum is valid...
  const r = gate({ bundleBytes: forged, manifest, signature: '' });
  assert.equal(r.ok, false); assert.equal(r.reason, 'signature-missing');
});

test('C2 bundle signed by an attacker key (impersonated or unknown key id) is rejected', () => {
  assert.equal(gate(signedBundle(validContent(), makeKey('desk-2026-11'), opts)).reason, 'signature-invalid');
  assert.equal(gate(signedBundle(validContent(), makeKey('someone-else'), opts)).reason, 'unknown-key');
});

test('C3 substituted content under a genuine signature is rejected', () => {
  const r = gate({ ...signedBundle(validContent(), desk, opts), bundleBytes: bytesOf(altered()) });
  assert.equal(r.ok, false); assert.ok(['hash-mismatch', 'size-mismatch'].includes(r.reason));
});

test('C4 substituted manifest (hash edited to match the attacker bundle) is rejected', () => {
  const genuine = signedBundle(validContent(), desk, opts);
  const sub = bytesOf(altered());
  const r = gate({ bundleBytes: sub, manifest: { ...genuine.manifest, sha256: sha256Hex(sub), size: sub.length }, signature: genuine.signature });
  assert.equal(r.reason, 'signature-invalid');
});

test('C5 replay, rollback, skipped sequence and stale head are rejected', () => {
  assert.equal(gate(signedBundle(validContent(), desk, { sequence: 5, basedOn: { sequence: 4, checkpointSha256: 'b'.repeat(64) } })).reason, 'replay-or-rollback');
  assert.equal(gate(signedBundle(validContent(), desk, { sequence: 7, basedOn: { sequence: 6, checkpointSha256: 'd'.repeat(64) } })).reason, 'sequence-gap');
  assert.equal(gate(signedBundle(validContent(), desk, { sequence: 6, basedOn: { sequence: 5, checkpointSha256: 'e'.repeat(64) } })).reason, 'based-on-mismatch');
  assert.equal(acceptBundle({ ...signedBundle(validContent(), desk, opts), trustStore, now: NOW }).reason, 'no-verified-head');
});

test('C6 genuine signature over forbidden private fields is still rejected by the content gate', () => {
  const c = validContent(); c.controls.hidden[0].reason = 'private reason';
  const r = gate(signedBundle(c, desk, opts));
  assert.equal(r.stage, 'content'); assert.ok(r.reason.includes('forbidden-field'));
});

test('C7 revoked and expired keys are rejected; a rotated key is accepted', () => {
  const revoked = makeKey('desk-old', { revokedAt: '2026-11-20T00:00:00Z' });
  const expired = makeKey('desk-exp', { notAfter: '2026-10-01T00:00:00Z' });
  const rotated = makeKey('desk-new', { notBefore: '2026-11-15T00:00:00Z' });
  const run = k => acceptBundle({ ...signedBundle(validContent(), k, opts), trustStore: [revoked.entry, expired.entry, rotated.entry], expected, now: NOW });
  assert.equal(run(revoked).reason, 'key-revoked');
  assert.equal(run(expired).reason, 'key-expired');
  assert.equal(run(rotated).ok, true);
});

test('C8 future-dated and stale bundles are rejected', () => {
  assert.equal(gate(signedBundle(validContent(), desk, { ...opts, createdAt: '2026-11-29T09:00:00Z' })).reason, 'created-in-future');
  assert.equal(gate(signedBundle(validContent(), desk, { ...opts, createdAt: '2026-09-01T09:00:00Z' })).reason, 'bundle-too-old');
});

test('A12 unreviewed AI badge and draft story are rejected even with a valid signature', () => {
  const c = validContent();
  c.classifications[0] = { ...c.classifications[0], badgeText: 'Verified by Observable', evidence: [] };
  delete c.classifications[0].review;
  c.stories[0] = { ...c.stories[0], status: 'draft', draft: true };
  const r = gate(signedBundle(c, desk, opts));
  assert.equal(r.stage, 'content');
  for (const e of ['forbidden-field:$.stories[0].draft', 'const:$.stories[0].status', 'min-items:$.classifications[0].evidence', 'required:$.classifications[0].review']) {
    assert.ok(r.errors.includes(e), `expected ${e}`);
  }
});
