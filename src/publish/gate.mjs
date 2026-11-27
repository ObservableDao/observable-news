// One publish run: discover the next draft, validate it, acknowledge it with a
// signed checkpoint, publish it as an immutable release, then re-verify what
// GitHub now holds. Holds no local state: everything is read from releases.
import { acceptBundle } from '../bundle/accept.mjs';
import { readHead, verifyPublication, tagFor, seqFromTag, BUNDLE_ASSETS, CHECKPOINT_ASSETS, DEFAULT_GATE_DEPTH,
  buildAcceptCheckpoint, buildSkipCheckpoint, encodeCheckpoint } from './checkpoint.mjs';

const sameSet = (a, b) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

export async function runPublish({ store, deskTrust, checkpointTrust, checkpointKey, checkpointKeyId, runId, now = Date.now() }) {
  const listing = await store.list();
  const state = await readHead(store, checkpointTrust, { now, listing });
  if (!state.ok) return { status: 'halted', stage: 'state', reason: state.problems[0].problem, at: state.problems[0].sequence };
  const head = state.head;
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

// Manual recovery only (workflow_dispatch by the repository owner).
// Records a signed skip on top of the last verifiable head so that the
// chain can continue after a forged, deleted or swapped publication.
export async function runSkip({ store, checkpointTrust, checkpointKey, checkpointKeyId, runId, reason, expectBase, now = Date.now() }) {
  const listing = await store.list();
  const pubSeqs = listing.filter(r => !r.draft && seqFromTag(r.tag) !== null).map(r => seqFromTag(r.tag));
  const top = pubSeqs.length ? Math.max(...pubSeqs) : 0;
  let base = null;
  for (let s = top; s >= 0 && !base; s--) {
    const st = await readHead(store, checkpointTrust, { now, listing, maxSequence: s, depth: DEFAULT_GATE_DEPTH });
    if (st.ok && st.head.sequence === s) base = st.head;
  }
  if (!base) return { status: 'halted', reason: 'no-verifiable-base' };
  if (expectBase !== base.sequence) return { status: 'refused', reason: 'base-not-confirmed', base: base.sequence };
  for (let seq = Math.max(top, base.sequence) + 1, tries = 0; tries < 20; seq++, tries++) {
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
    return { status: 'skipped', base: base.sequence, sequence: seq, voided: seq - base.sequence - 1 };
  }
  return { status: 'halted', reason: 'no-free-sequence' };
}

export { CHECKPOINT_ASSETS };
