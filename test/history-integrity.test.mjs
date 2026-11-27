// M0 security acceptance test D: publication-history integrity (local part).
// Live GitHub behaviour of immutable releases (D-L1..D-L4) is run after the
// repositories exist; see docs/SECURITY-TESTS.md.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBatch, verifyChain, restoreFromMirror, slotId, nextSlot, worstCaseLossHours, batchIsIntact } from '../src/history/chain.mjs';

function buildHistory(firstSlot, n) {
  const byId = new Map(); let prev = 'genesis'; let id = firstSlot;
  for (let i = 0; i < n; i++) {
    const b = makeBatch({ batchId: id, records: [{ kind: 'item', id: `${id}-1`, url: 'https://example.com/1' }, { kind: 'item', id: `${id}-2`, url: 'https://example.com/2' }], prevManifestSha256: prev, createdAt: `${id}:00:00Z` });
    byId.set(id, b); prev = b.manifestSha256; id = nextSlot(id);
  }
  return byId;
}
const FIRST = '2026-11-01T00';
const N = 28; // 7 days of 6-hour batches
const LAST = [...buildHistory(FIRST, N).keys()].at(-1);

test('D0 control: an untouched 7-day chain verifies cleanly', () => {
  assert.deepEqual(verifyChain(buildHistory(FIRST, N), FIRST, LAST), []);
  assert.equal(slotId('2026-11-27T20:15:00Z'), '2026-11-27T18');
});

test('D1 tampering with a record inside a batch is detected', () => {
  const h = buildHistory(FIRST, N); const id = '2026-11-03T12'; const b = h.get(id);
  h.set(id, { ...b, recordsBytes: Buffer.from(b.recordsBytes.toString().replace('example.com/1', 'evil.example/1')) });
  assert.deepEqual(verifyChain(h, FIRST, LAST).map(p => p.problem), ['tampered']);
});

test('D2 a forged replacement batch (self-consistent, re-hashed) breaks the chain', () => {
  const h = buildHistory(FIRST, N); const id = '2026-11-04T06'; const orig = h.get(id);
  const forged = makeBatch({ batchId: id, records: [{ kind: 'item', id: 'forged', url: 'https://evil.example' }], prevManifestSha256: orig.manifest.prevManifestSha256, createdAt: orig.manifest.createdAt });
  assert.equal(batchIsIntact(forged), true);
  h.set(id, forged);
  const problems = verifyChain(h, FIRST, LAST);
  assert.deepEqual(problems, [{ slot: nextSlot(id), problem: 'chain-break' }]);
});

test('D3 deletion of a batch is detected as missing', () => {
  const h = buildHistory(FIRST, N); h.delete('2026-11-05T18');
  assert.deepEqual(verifyChain(h, FIRST, LAST)[0], { slot: '2026-11-05T18', problem: 'missing' });
});

test('D4 recovery from the private mirror restores deleted and tampered batches', () => {
  const mirror = buildHistory(FIRST, N);
  const pub = new Map([...mirror]);
  pub.delete('2026-11-02T00'); pub.delete('2026-11-02T06');
  const t = pub.get('2026-11-06T12');
  pub.set('2026-11-06T12', { ...t, recordsBytes: Buffer.from('tampered\n') });
  const { restored, report } = restoreFromMirror(pub, mirror, FIRST, LAST);
  assert.equal(report.unrecoverable.length, 0);
  assert.equal(report.fromMirror, 3);
  assert.deepEqual(verifyChain(restored, FIRST, LAST), []);
});

test('D5 a batch missing from both copies is reported as unrecoverable, never silently skipped', () => {
  const mirror = buildHistory(FIRST, N); const pub = new Map([...mirror]);
  mirror.delete('2026-11-07T00'); pub.delete('2026-11-07T00');
  const { report } = restoreFromMirror(pub, mirror, FIRST, LAST);
  assert.ok(report.unrecoverable.includes('2026-11-07T00'));
});

test('D6 maximum publication history that can be lost', () => {
  assert.deepEqual(worstCaseLossHours(), { publicHistoryIntact: 6, publicHistoryLostMirrorOnly: 30 });
});
