// Fix 5: the mirror verifies history integrity instead of copying files.
// Each mirror run is a separate process (scripts/mirror-history.mjs) against
// simulated public and private release stores.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FsReleaseStore } from '../src/transport/fs-store.mjs';
import { makeBatch, nextSlot } from '../src/history/chain.mjs';
import { publishBatch, mirrorHistory, PUBLIC_PREFIX } from '../src/history/mirror.mjs';
import { canonicalJSON } from '../src/bundle/signature.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');

async function setup(n = 8) {
  const root = mkdtempSync(join(tmpdir(), 'mirror-'));
  const pub = new FsReleaseStore(join(root, 'public')), mir = new FsReleaseStore(join(root, 'private'));
  let prev = 'genesis', id = '2026-11-01T00'; const batches = [];
  for (let i = 0; i < n; i++) {
    const b = makeBatch({ batchId: id, records: [{ kind: 'item', id: `${id}-1`, url: 'https://example.com/1' }], prevManifestSha256: prev, createdAt: `${id}:00:00Z` });
    batches.push(b); prev = b.manifestSha256; id = nextSlot(id);
  }
  const run = () => {
    const r = spawnSync(process.execPath, [join(repo, 'scripts/mirror-history.mjs'), '--source', 'fs:' + join(root, 'public'), '--mirror', 'fs:' + join(root, 'private')],
      { cwd: mkdtempSync(join(tmpdir(), 'runner-')), encoding: 'utf8', env: { PATH: process.env.PATH } });
    return { status: r.status, h: JSON.parse(r.stdout.trim()).history };
  };
  return { pub, mir, batches, run };
}
const publishN = async (s, batches) => { for (const b of batches) await publishBatch(s, PUBLIC_PREFIX, b); };

test('M1 intact history is copied once, then the next run is idempotent', async () => {
  const { pub, batches, run } = await setup(); await publishN(pub, batches);
  const r1 = run(); assert.deepEqual([r1.status, r1.h.copied.length, r1.h.ok], [0, 8, true]);
  const r2 = run(); assert.deepEqual([r2.status, r2.h.copied.length, r2.h.alreadyMirrored.length], [0, 0, 8]);
});

test('M2 a tampered public batch is refused, not copied, and the run fails', async () => {
  const { pub, batches, run } = await setup();
  const bad = { ...batches[3], recordsBytes: Buffer.from(batches[3].recordsBytes.toString().replace('example.com', 'evil.example')) };
  await publishN(pub, [...batches.slice(0, 3), bad, ...batches.slice(4)]);
  const r = run();
  assert.equal(r.status, 1);
  assert.deepEqual(r.h.refused[0], { slot: batches[3].batchId, problem: 'tampered' });
  assert.ok(!r.h.copied.includes(batches[3].batchId));
  assert.ok(r.h.unrecoverable.includes(batches[3].batchId));
});

test('M3 a public batch that differs from the mirror is reported, never overwritten', async () => {
  const { pub, mir, batches, run } = await setup(4);
  await publishN(pub, batches); assert.equal(run().status, 0);
  // The public copy of slot 2 now serves different, self-consistent content
  // (as if re-created elsewhere). The mirror must flag it, not overwrite.
  const forged = makeBatch({ batchId: batches[2].batchId, records: [{ kind: 'item', id: 'x', url: 'https://evil.example/' }], prevManifestSha256: batches[1].manifestSha256, createdAt: 'x' });
  const target = (await pub.list()).find(r => r.tag === PUBLIC_PREFIX + batches[2].batchId);
  const divergentPublic = {
    list: () => pub.list(),
    download: (id, n) => id !== target.id ? pub.download(id, n)
      : Promise.resolve(n === 'records.jsonl' ? forged.recordsBytes : Buffer.from(canonicalJSON(forged.manifest))),
  };
  const before = JSON.stringify(await mir.list());
  const rep = await mirrorHistory({ source: divergentPublic, mirror: mir });
  assert.deepEqual(rep.divergent, [batches[2].batchId]);
  assert.equal(rep.ok, false);
  assert.equal(JSON.stringify(await mir.list()), before, 'mirror unchanged');
});

test('M4 a deleted public batch is reported as recoverable from the mirror', async () => {
  const { pub, batches, run } = await setup(4);
  await publishN(pub, batches); assert.equal(run().status, 0);
  const rel = (await pub.list()).find(r => r.tag === PUBLIC_PREFIX + batches[1].batchId);
  await pub.remove(rel.id);
  const r = run();
  assert.equal(r.status, 1);
  assert.deepEqual(r.h.publicMissing, [batches[1].batchId]);
  assert.deepEqual(r.h.unrecoverable, []);
});

test('M5 after a gap, later batches are not copied until the chain is repaired', async () => {
  const { pub, batches, run } = await setup(5);
  await publishN(pub, [batches[0], batches[1], batches[3], batches[4]]); // slot 2 never published
  const r = run();
  assert.equal(r.status, 1);
  assert.deepEqual(r.h.copied, [batches[0].batchId, batches[1].batchId]);
  assert.deepEqual(r.h.refused.map(x => x.problem), ['chain-break', 'chain-break']);
});

test('M6 the disabled history workflows stay disabled and unscheduled', () => {
  for (const p of [join(repo, 'proposed-workflows/history.yml'), join(repo, '..', 'observable-news-desk/proposed-workflows/mirror-history.yml')]) {
    let text; try { text = readFileSync(p, 'utf8'); } catch { continue; }
    assert.ok(!/^\s*schedule:/m.test(text), `${p} must have no schedule`);
    assert.ok(/if: \$\{\{ false \}\}/.test(text), `${p} must be switched off`);
  }
  const gen = spawnSync(process.execPath, [join(repo, 'scripts/build-history-batch.mjs')], { encoding: 'utf8' });
  assert.equal(gen.status, 1, 'the batch generator placeholder fails closed');
});
