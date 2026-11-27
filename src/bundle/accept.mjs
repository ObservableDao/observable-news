// The single public-side gate: authenticity first, then content rules.
import { verifyBundle } from './signature.mjs';
import { validateBundleContent } from './allowlist.mjs';

export function acceptBundle(input) {
  const auth = verifyBundle(input);
  if (!auth.ok) return { ok: false, stage: 'authenticity', reason: auth.reason };
  const content = validateBundleContent(input.bundleBytes);
  if (!content.ok) return { ok: false, stage: 'content', reason: content.errors.join(',') };
  return { ok: true, sequence: auth.sequence };
}
