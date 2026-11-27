// Publication history as a hash chain of fixed 6-hour batches.
// Each completed batch is published as its own immutable GitHub release
// (tag history-YYYY-MM-DDTHH). The in-progress batch lives only in the
// encrypted working state until its slot closes.
import { createHash } from 'node:crypto';
import { canonicalJSON } from '../bundle/signature.mjs';

export const BATCH_HOURS = 6;
const sha = b => createHash('sha256').update(b).digest('hex');

export function slotId(date) {
  const d = new Date(date);
  const h = Math.floor(d.getUTCHours() / BATCH_HOURS) * BATCH_HOURS;
  return `${d.toISOString().slice(0, 10)}T${String(h).padStart(2, '0')}`;
}

export function nextSlot(id) {
  const d = new Date(`${id}:00:00Z`);
  d.setUTCHours(d.getUTCHours() + BATCH_HOURS);
  return slotId(d);
}

export function encodeRecords(records) {
  return Buffer.from(records.map(r => canonicalJSON(r)).join('\n') + '\n', 'utf8');
}

export function makeBatch({ batchId, records, prevManifestSha256, createdAt }) {
  const recordsBytes = encodeRecords(records);
  const manifest = { v: 1, batchId, count: records.length, recordsSha256: sha(recordsBytes), prevManifestSha256, createdAt };
  return { batchId, recordsBytes, manifest, manifestSha256: sha(Buffer.from(canonicalJSON(manifest))) };
}

// Verify a single batch in isolation (content matches its own manifest).
export function batchIsIntact(b) {
  if (!b || !b.manifest || !b.recordsBytes) return false;
  if (sha(b.recordsBytes) !== b.manifest.recordsSha256) return false;
  if (sha(Buffer.from(canonicalJSON(b.manifest))) !== b.manifestSha256) return false;
  const lines = b.recordsBytes.toString('utf8').split('\n').filter(Boolean);
  return lines.length === b.manifest.count && b.batchId === b.manifest.batchId;
}

function manifestIsAuthentic(b) {
  return !!(b && b.manifest && sha(Buffer.from(canonicalJSON(b.manifest))) === b.manifestSha256);
}

// Verify a chain from firstSlot to lastSlot inclusive. Returns problems found.
export function verifyChain(batchesById, firstSlot, lastSlot) {
  const problems = [];
  let prev = 'genesis';
  for (let id = firstSlot; ; id = nextSlot(id)) {
    const b = batchesById.get(id);
    if (!b) problems.push({ slot: id, problem: 'missing' });
    else if (!batchIsIntact(b)) problems.push({ slot: id, problem: 'tampered' });
    else if (b.manifest.prevManifestSha256 !== prev) problems.push({ slot: id, problem: 'chain-break' });
    // Advance along the chain whenever the manifest itself is authentic, so a
    // tampered payload is reported once (as 'tampered'), not again as a break.
    prev = b && manifestIsAuthentic(b) ? b.manifestSha256 : prev;
    if (id === lastSlot) break;
  }
  return problems;
}

// Rebuild the best history from the public releases plus the private mirror.
export function restoreFromMirror(publicById, mirrorById, firstSlot, lastSlot) {
  const restored = new Map();
  const report = { fromPublic: 0, fromMirror: 0, unrecoverable: [] };
  let prev = 'genesis';
  for (let id = firstSlot; ; id = nextSlot(id)) {
    const candidates = [['public', publicById.get(id)], ['mirror', mirrorById.get(id)]];
    const pick = candidates.find(([, b]) => b && batchIsIntact(b) && b.manifest.prevManifestSha256 === prev);
    if (pick) {
      restored.set(id, pick[1]);
      report[pick[0] === 'public' ? 'fromPublic' : 'fromMirror']++;
      prev = pick[1].manifestSha256;
    } else {
      report.unrecoverable.push(id);
    }
    if (id === lastSlot) break;
  }
  return { restored, report };
}

// Worst-case loss of publication records (recovery point objective), in hours.
export function worstCaseLossHours({ batchHours = BATCH_HOURS, mirrorHours = 24 } = {}) {
  return {
    publicHistoryIntact: batchHours,            // only the open batch, if the encrypted state is also lost
    publicHistoryLostMirrorOnly: batchHours + mirrorHours, // open batch + batches not yet mirrored
  };
}
