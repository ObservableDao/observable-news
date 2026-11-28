// One publish run: discover the next draft, validate it, acknowledge it with a
// signed checkpoint, publish it as an immutable release, then re-verify what
// GitHub now holds. Holds no local state: everything is read from releases.
import { randomInt } from 'node:crypto';
import { acceptBundle } from '../bundle/accept.mjs';
import { verifySignedObject } from '../bundle/signature.mjs';
import { readHead, verifyPublication, tagFor, seqFromTag, CHECKPOINT_DOMAIN, BUNDLE_ASSETS, CHECKPOINT_ASSETS, DEFAULT_GATE_DEPTH,
  buildAcceptCheckpoint, buildSkipCheckpoint, encodeCheckpoint, MAX_SEQUENCE, GENESIS } from './checkpoint.mjs';

const sameSet = (a, b) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

export async function runPublish({ store, deskTrust, checkpointTrust, checkpointKey, checkpointKeyId, runId, now = Date.now() }) {
  const listing = await store.list();
  const state = await readHead(store, checkpointTrust, { now, listing });
  if (!state.ok) return { status: 'halted', stage: 'state', reason: state.problems[0].problem, at: state.problems[0].sequence };
  const head = state.head;
  if (head.sequence >= MAX_SEQUENCE) return { status: 'halted', stage: 'state', reason: 'sequence-space-exhausted', at: head.sequence };
  const next = head.sequence + 1, tag = tagFor(next);

  const drafts = listing.filter(r => r.draft && r.tag === tag);
  if (drafts.length === 0) return { status: 'nothing-to-do', head: head.sequence };
  const reject = async (stage, reason, extra = {}) => {
    for (const d of drafts) await store.remove(d.id).catch(() => {});
    return { status: 'rejected', stage, reason, sequence: next, ...extra };
  };
  if (drafts.length > 1) return reject('transport', 'ambiguous-drafts');
  const draft = drafts[0];
  if (!sameSet(draft.assets.map(a => a.name), BUNDLE_ASSETS)) return reject('transport', 'unexpected-assets');

  const bundleBytes = await store.download(draft.id, 'bundle.json');
  const manifestBytes = await store.download(draft.id, 'manifest.json');
  const signatureBytes = await store.download(draft.id, 'signature.txt');
  let manifest;
  try { manifest = JSON.parse(manifestBytes.toString('utf8')); } catch { return reject('transport', 'manifest-not-json'); }

  const result = acceptBundle({
    bundleBytes, manifest, signature: signatureBytes.toString('utf8').trim(), trustStore: deskTrust,
    expected: { sequence: next, basedOn: { sequence: head.sequence, checkpointSha256: head.checkpointSha256 } }, now,
  });
  if (!result.ok) return reject(result.stage, result.stage === 'content' ? 'content-invalid' : result.reason, { errors: result.errors });

  const cp = buildAcceptCheckpoint({ sequence: next, prev: head, bundleBytes, manifestBytes, signatureBytes,
    deskKeyId: manifest.keyId, createdAt: new Date(now).toISOString(), runId, keyId: checkpointKeyId });
  const enc = encodeCheckpoint(cp, checkpointKey);
  // Never consume a sequence with a checkpoint that would not verify (retired,
  // not-yet-valid, revoked or unlisted key): stop before anything is published.
  const selfCheck = verifySignedObject({ domain: CHECKPOINT_DOMAIN, obj: cp, signature: enc.sig.toString('utf8').trim(), keyId: cp.keyId, createdAt: cp.createdAt, trustStore: checkpointTrust, now });
  if (selfCheck) return { status: 'halted', stage: 'signing', reason: 'checkpoint-key-not-valid', detail: selfCheck, at: next };
  await store.upload(draft.id, 'checkpoint.json', enc.json);
  await store.upload(draft.id, 'checkpoint.sig', enc.sig);
  try {
    await store.publish(draft.id);
  } catch (e) {
    if (e.code === 'tag-already-used') { await store.remove(draft.id).catch(() => {}); return { status: 'halted', stage: 'state', reason: 'sequence-already-used', at: next }; }
    throw e;
  }

  // Re-read from the store: prove the immutable release holds exactly what was validated.
  const published = (await store.list()).find(r => r.id === draft.id);
  const v = published ? await verifyPublication(store, published, checkpointTrust, now) : { ok: false, problem: 'vanished' };
  if (!v.ok) return { status: 'halted', stage: 'post-publish', reason: v.problem, at: next };
  return { status: 'accepted', sequence: next, checkpointSha256: v.checkpointSha256, bundleSha256: cp.bundleSha256 };
}

// Candidate offsets above the starting point for a skip: first the next 20
// sequences, then one random sequence in each doubling band. An attacker who
// burns tag names (publish then delete) cannot predict which ones to burn, so
// blocking recovery would mean burning whole bands; the gap this leaves in the
// 99,999,999-number sequence space stays small in practice.
export function* probeOffsets(random = randomInt) {
  for (let i = 1; i <= 20; i++) yield i;
  for (let k = 5; k <= 26; k++) yield 2 ** k + random(2 ** k);
}

// Manual recovery only (workflow_dispatch by the repository owner).
// 1. Find the highest verifiable head (the base) and require the operator to confirm it.
// 2. Delete every published pub-* release above the base that does not verify
//    (forged, corrupted, swapped, not immutable). Deleting cannot reopen a
//    sequence, because GitHub never reuses the tag name, and it removes the
//    blocker however high its sequence number is.
// 3. Record a signed skip on top of the base and any genuine releases above it,
//    at the first tag name that has never been used.
export async function runSkip({ store, checkpointTrust, checkpointKey, checkpointKeyId, runId, reason, expectBase, now = Date.now(), random = randomInt }) {
  const listing = await store.list();
  const published = listing.filter(r => !r.draft && seqFromTag(r.tag) !== null);
  const candidates = [...new Set(published.map(r => seqFromTag(r.tag)))].sort((a, b) => b - a);
  let base = null;
  for (const s of candidates) {
    const st = await readHead(store, checkpointTrust, { now, listing, maxSequence: s, depth: DEFAULT_GATE_DEPTH });
    if (st.ok && st.head.sequence === s) { base = st.head; break; }
  }
  if (!base) base = { ...GENESIS };
  if (expectBase !== base.sequence) return { status: 'refused', reason: 'base-not-confirmed', base: base.sequence };

  const removed = []; let start = base.sequence;
  for (const r of published) {
    const seq = seqFromTag(r.tag);
    if (seq <= base.sequence) continue;
    const v = await verifyPublication(store, r, checkpointTrust, now);
    // Keep genuine releases cut off from the chain, and releases signed by a
    // revoked checkpoint key (history is preserved, never trusted): skip above them.
    if (v.ok || v.problem === 'checkpoint-key-revoked') start = Math.max(start, seq);
    else { await store.remove(r.id); removed.push({ sequence: seq, problem: v.problem }); }
  }

  for (const offset of probeOffsets(random)) {
    const seq = start + offset;
    if (seq > MAX_SEQUENCE) break;
    const cp = buildSkipCheckpoint({ sequence: seq, prev: base, reason, createdAt: new Date(now).toISOString(), runId, keyId: checkpointKeyId });
    const enc = encodeCheckpoint(cp, checkpointKey);
    const id = await store.createDraft(tagFor(seq));
    await store.upload(id, 'checkpoint.json', enc.json);
    await store.upload(id, 'checkpoint.sig', enc.sig);
    try { await store.publish(id); } catch (e) {
      await store.remove(id).catch(() => {});
      if (e.code === 'tag-already-used') continue;
      throw e;
    }
    // Prove the system is operational again before reporting success.
    const after = await readHead(store, checkpointTrust, { now });
    if (!after.ok || after.head.sequence !== seq) return { status: 'halted', reason: 'recovery-not-effective', problems: after.problems, removed: removed.length };
    return { status: 'skipped', base: base.sequence, sequence: seq, removed: removed.length, removedSequences: removed.slice(0, 50) };
  }
  return { status: 'halted', reason: 'no-free-sequence', base: base.sequence, removed: removed.length };
}

export { CHECKPOINT_ASSETS };
