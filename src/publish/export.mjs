// Desk-side export, shared by observable-news-desk/scripts/export.mjs and the tests.
// The sequence is never chosen by the caller: it is the verified public head + 1,
// and the manifest is bound to that head (basedOn).
import { buildManifest, signManifest } from '../bundle/signature.mjs';
import { validateBundleContent } from '../bundle/allowlist.mjs';
import { readHead, tagFor } from './checkpoint.mjs';

export async function exportBundle({ store, checkpointTrust, bundleBytes, sourceCommit, deskKey, deskKeyId, now = Date.now(), advisory = true }) {
  const state = await readHead(store, checkpointTrust, { now });
  if (!state.ok) return { ok: false, reason: 'public-state-halted', problem: state.problems[0].problem };
  if (advisory) {
    const v = validateBundleContent(bundleBytes, { now });
    if (!v.ok) return { ok: false, reason: 'advisory-validation-failed', errors: v.errors };
  }
  const sequence = state.head.sequence + 1;
  const manifest = buildManifest({ bundleBytes, sequence, basedOn: state.head, sourceCommit, createdAt: new Date(now).toISOString(), keyId: deskKeyId });
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  const signatureBytes = Buffer.from(signManifest(manifest, deskKey) + '\n', 'utf8');

  // Replace any earlier unprocessed draft for this sequence: the newest approved export wins.
  const tag = tagFor(sequence);
  for (const r of await store.list()) if (r.draft && r.tag === tag) await store.remove(r.id);
  const id = await store.createDraft(tag);
  await store.upload(id, 'bundle.json', bundleBytes);
  await store.upload(id, 'manifest.json', manifestBytes);
  await store.upload(id, 'signature.txt', signatureBytes);
  await store.dispatch('content-approved', { sequence });
  return { ok: true, sequence, tag, bytes: bundleBytes.length, bundleSha256: manifest.sha256, files: { bundleBytes, manifestBytes, signatureBytes } };
}
