// Has the public repository acknowledged an export? Read-only.
// States: acknowledged | pending | not-pending (rejected or never seen) | superseded | mismatch | halted
import { readHead, verifyPublication, tagFor } from './checkpoint.mjs';

export async function checkAck({ store, checkpointTrust, sequence, bundleSha256, now = Date.now() }) {
  const listing = await store.list();
  const state = await readHead(store, checkpointTrust, { listing, now });
  if (!state.ok) return { sequence, state: 'halted', problem: state.problems[0].problem };
  const rel = listing.find(r => r.tag === tagFor(sequence) && !r.draft);
  if (rel) {
    const v = await verifyPublication(store, rel, checkpointTrust, now);
    if (!v.ok) return { sequence, state: 'halted', problem: v.problem };
    const ok = v.checkpoint.type === 'accept' && v.checkpoint.bundleSha256 === bundleSha256;
    return { sequence, state: ok ? 'acknowledged' : 'mismatch', checkpointSha256: v.checkpointSha256 };
  }
  if (state.head.sequence >= sequence) return { sequence, state: 'superseded' };
  return { sequence, state: listing.some(r => r.draft && r.tag === tagFor(sequence)) ? 'pending' : 'not-pending' };
}
