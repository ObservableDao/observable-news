// Durable, authenticated anti-replay state using only GitHub Free features (no Cloudflare storage).
//
// Every publication is one GitHub release with the tag pub-NNNNNNNN, where N
// is the publication sequence. The desk creates it as a DRAFT holding
// bundle.json, manifest.json and signature.txt. The public publish workflow
// validates the draft, attaches a signed checkpoint (checkpoint.json,
// checkpoint.sig) and publishes it. With release immutability on, publishing
// locks the assets and the tag, and the tag name can never be reused, even
// if the release is later deleted.
//
// That gives a monotonic counter that survives ephemeral runners:
//   * the head is the highest published pub-* release whose checkpoint
//     verifies (Ed25519 key held only in the public "production" environment);
//   * sequence N+1 is accepted only if it was built on head N (basedOn);
//   * a replayed or rolled-back bundle names an old sequence or an old head;
//   * deleting releases cannot reopen a sequence: its tag is already used, so
//     the next publish fails closed and an operator must record a signed skip.
import { canonicalJSON, objectSha256, sha256Hex, signObject, verifySignedObject } from '../bundle/signature.mjs';

export const CHECKPOINT_DOMAIN = 'observable-news/publish-checkpoint/v1\n';
export const GENESIS = Object.freeze({ sequence: 0, checkpointSha256: 'genesis' });
export const BUNDLE_ASSETS = ['bundle.json', 'manifest.json', 'signature.txt'];
export const CHECKPOINT_ASSETS = ['checkpoint.json', 'checkpoint.sig'];
export const DEFAULT_GATE_DEPTH = 3;          // the daily audit verifies the whole chain
export const SKIP_REASONS = ['forged-release', 'deleted-release', 'asset-swap', 'operator'];

export const tagFor = seq => `pub-${String(seq).padStart(8, '0')}`;
export const seqFromTag = tag => { const m = /^pub-(\d{8})$/.exec(tag || ''); return m ? Number(m[1]) : null; };
const sameSet = (a, b) => a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');

export function buildAcceptCheckpoint({ sequence, prev, bundleBytes, manifestBytes, signatureBytes, deskKeyId, createdAt, runId, keyId }) {
  return {
    v: 1, kind: 'observable-publish-checkpoint', type: 'accept',
    sequence, prevSequence: prev.sequence, prevCheckpointSha256: prev.checkpointSha256,
    bundleSha256: sha256Hex(bundleBytes), manifestSha256: sha256Hex(manifestBytes), signatureSha256: sha256Hex(signatureBytes),
    deskKeyId, createdAt, runId: String(runId), keyId,
  };
}

export function buildSkipCheckpoint({ sequence, prev, reason, createdAt, runId, keyId }) {
  if (!SKIP_REASONS.includes(reason)) throw new Error('unknown skip reason');
  return {
    v: 1, kind: 'observable-publish-checkpoint', type: 'skip',
    sequence, prevSequence: prev.sequence, prevCheckpointSha256: prev.checkpointSha256,
    reason, createdAt, runId: String(runId), keyId,
  };
}

export function encodeCheckpoint(cp, privateKey) {
  return { json: Buffer.from(canonicalJSON(cp), 'utf8'), sig: Buffer.from(signObject(CHECKPOINT_DOMAIN, cp, privateKey) + '\n', 'utf8') };
}

// Verify one published pub-* release in isolation.
export async function verifyPublication(store, release, trust, now) {
  const fail = problem => ({ ok: false, problem, sequence: seqFromTag(release.tag) });
  const sequence = seqFromTag(release.tag);
  if (release.draft) return fail('is-draft');
  if (release.immutable !== true) return fail('not-immutable');
  const names = release.assets.map(a => a.name);
  let raw;
  try { raw = await store.download(release.id, 'checkpoint.json'); } catch { return fail('checkpoint-missing'); }
  let cp;
  try { cp = JSON.parse(raw.toString('utf8')); } catch { return fail('checkpoint-not-json'); }
  if (canonicalJSON(cp) !== raw.toString('utf8')) return fail('checkpoint-not-canonical');
  if (cp.v !== 1 || cp.kind !== 'observable-publish-checkpoint') return fail('checkpoint-kind');
  let sig = '';
  try { sig = (await store.download(release.id, 'checkpoint.sig')).toString('utf8').trim(); } catch { return fail('checkpoint-signature-missing'); }
  const sigProblem = verifySignedObject({ domain: CHECKPOINT_DOMAIN, obj: cp, signature: sig, keyId: cp.keyId, createdAt: cp.createdAt, trustStore: trust, now });
  if (sigProblem) return fail('checkpoint-' + sigProblem);
  if (cp.sequence !== sequence) return fail('checkpoint-sequence-mismatch');
  if (!Number.isSafeInteger(cp.prevSequence) || cp.prevSequence < 0) return fail('checkpoint-prev-invalid');
  if (cp.prevSequence === 0 && cp.prevCheckpointSha256 !== 'genesis') return fail('checkpoint-prev-invalid');
  if (cp.type === 'accept') {
    if (cp.prevSequence !== sequence - 1) return fail('accept-not-contiguous');
    if (!sameSet(names, [...BUNDLE_ASSETS, ...CHECKPOINT_ASSETS])) return fail('unexpected-assets');
    for (const [name, field] of [['bundle.json', 'bundleSha256'], ['manifest.json', 'manifestSha256'], ['signature.txt', 'signatureSha256']]) {
      const bytes = await store.download(release.id, name);
      if (sha256Hex(bytes) !== cp[field]) return fail('asset-hash-mismatch');
    }
  } else if (cp.type === 'skip') {
    if (cp.prevSequence >= sequence) return fail('skip-prev-invalid');
    if (!SKIP_REASONS.includes(cp.reason)) return fail('skip-reason-invalid');
    if (!sameSet(names, CHECKPOINT_ASSETS)) return fail('unexpected-assets');
  } else return fail('checkpoint-type');
  return { ok: true, sequence, checkpoint: cp, checkpointSha256: objectSha256(cp) };
}

// Find and verify the publication head.
// depth: how many links below the head to verify (Infinity = full audit).
// maxSequence: ignore releases above this (used only by recovery).
export async function readHead(store, trust, { now = Date.now(), depth = DEFAULT_GATE_DEPTH, listing, maxSequence = Infinity } = {}) {
  const releases = listing || await store.list();
  const published = new Map();
  for (const r of releases) {
    const s = seqFromTag(r.tag);
    if (s !== null && !r.draft && s <= maxSequence) published.set(s, r);
  }
  if (published.size === 0) return { ok: true, head: { ...GENESIS }, verified: [] };
  const top = Math.max(...published.keys());
  const verified = [];
  let cur = top, expectSha = null, head = null;
  for (let steps = 0; ; steps++) {
    const r = published.get(cur);
    if (!r) return { ok: false, problems: [{ sequence: cur, problem: 'missing' }], verified };
    const v = await verifyPublication(store, r, trust, now);
    if (!v.ok) return { ok: false, problems: [{ sequence: cur, problem: v.problem, isTop: cur === top }], verified };
    if (expectSha && v.checkpointSha256 !== expectSha) return { ok: false, problems: [{ sequence: cur, problem: 'chain-break' }], verified };
    if (!head) head = { sequence: cur, checkpointSha256: v.checkpointSha256, type: v.checkpoint.type };
    verified.push(cur);
    const cp = v.checkpoint;
    if (cp.prevSequence === 0 || steps + 1 >= depth) break;
    expectSha = cp.prevCheckpointSha256; cur = cp.prevSequence;
  }
  return { ok: true, head, verified };
}
