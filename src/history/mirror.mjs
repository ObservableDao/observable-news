// Verifying mirror for publication history.
// Copies a public history batch into the private mirror ONLY if it is intact
// and links correctly to the chain reconstructed from public + mirror. It
// never overwrites a mirrored batch, and it reports (and fails on) any
// tampered, divergent, missing or unrecoverable slot instead of copying it.
import { createHash } from 'node:crypto';
import { canonicalJSON } from '../bundle/signature.mjs';
import { batchIsIntact, restoreFromMirror, nextSlot } from './chain.mjs';

const sha = b => createHash('sha256').update(b).digest('hex');
const ASSETS = ['manifest.json', 'records.jsonl'];
export const PUBLIC_PREFIX = 'history-';
export const MIRROR_PREFIX = 'mirror-history-';

export async function loadBatches(store, prefix) {
  const re = new RegExp('^' + prefix.replace(/[-]/g, '\\-') + '(\\d{4}-\\d{2}-\\d{2}T\\d{2})$');
  const batches = new Map(); const problems = [];
  for (const r of await store.list()) {
    const m = re.exec(r.tag); if (!m || r.draft) continue;
    const slot = m[1];
    if (r.immutable !== true) problems.push({ slot, problem: 'not-immutable' });
    const names = r.assets.map(a => a.name).sort();
    if (names.join() !== ASSETS.join()) { problems.push({ slot, problem: 'unexpected-assets' }); continue; }
    const recordsBytes = await store.download(r.id, 'records.jsonl');
    const raw = (await store.download(r.id, 'manifest.json')).toString('utf8');
    let manifest; try { manifest = JSON.parse(raw); } catch { problems.push({ slot, problem: 'manifest-not-json' }); continue; }
    if (canonicalJSON(manifest) !== raw) { problems.push({ slot, problem: 'manifest-not-canonical' }); continue; }
    batches.set(slot, { batchId: slot, recordsBytes, manifest, manifestSha256: sha(Buffer.from(raw)) });
  }
  return { batches, problems };
}

export async function publishBatch(store, prefix, batch) {
  const id = await store.createDraft(prefix + batch.batchId);
  await store.upload(id, 'records.jsonl', batch.recordsBytes);
  await store.upload(id, 'manifest.json', Buffer.from(canonicalJSON(batch.manifest)));
  await store.publish(id);
}

export async function mirrorHistory({ source, mirror }) {
  const pub = await loadBatches(source, PUBLIC_PREFIX);
  const mir = await loadBatches(mirror, MIRROR_PREFIX);
  const report = { copied: [], alreadyMirrored: [], refused: [], divergent: [], publicMissing: [], unrecoverable: [],
    sourceProblems: pub.problems, mirrorProblems: mir.problems };
  const slots = [...new Set([...pub.batches.keys(), ...mir.batches.keys()])].sort();
  if (slots.length) {
    const first = slots[0], last = slots[slots.length - 1];
    const { restored, report: rr } = restoreFromMirror(pub.batches, mir.batches, first, last);
    report.unrecoverable = rr.unrecoverable;
    for (let slot = first; ; slot = nextSlot(slot)) {
      const p = pub.batches.get(slot), m = mir.batches.get(slot), good = restored.get(slot);
      if (p && m) {
        if (p.manifestSha256 !== m.manifestSha256 || !batchIsIntact(p)) report.divergent.push(slot);
        else report.alreadyMirrored.push(slot);
      } else if (p) {
        if (good === p) { await publishBatch(mirror, MIRROR_PREFIX, p); report.copied.push(slot); }
        else report.refused.push({ slot, problem: batchIsIntact(p) ? 'chain-break' : 'tampered' });
      } else if (m && good === m) report.publicMissing.push(slot);
      if (slot === last) break;
    }
  }
  report.ok = !report.refused.length && !report.divergent.length && !report.publicMissing.length &&
    !report.unrecoverable.length && !report.sourceProblems.length && !report.mirrorProblems.length;
  return report;
}
