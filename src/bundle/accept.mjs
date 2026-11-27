// The single public-side gate: authenticity and freshness first, then content.
import { verifyBundle } from './signature.mjs';
import { validateBundleContent } from './allowlist.mjs';

export function acceptBundle(input) {
  const now = input.now ?? Date.now();
  const auth = verifyBundle({ ...input, now });
  if (!auth.ok) return { ok: false, stage: 'authenticity', reason: auth.reason };
  const content = validateBundleContent(input.bundleBytes, { now });
  if (!content.ok) return { ok: false, stage: 'content', reason: content.errors.join(','), errors: content.errors };
  return { ok: true, sequence: auth.sequence };
}
