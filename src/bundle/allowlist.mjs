// Public-side content validation for approved bundles.
// This runs on EVERY bundle, even one with a valid signature, because the
// private repository has no enforced branch protection on GitHub Free.

const TOP_LEVEL = new Set(['schemaVersion', 'stories', 'explainers', 'classifications', 'imageCredits', 'corrections', 'controls']);
const CONTROL_KEYS = new Set(['featured', 'hidden', 'grouping']);
// Keys that must never leave the private repository, at any depth.
const FORBIDDEN_KEYS = new Set(['draft', 'drafts', 'notes', 'note', 'reason', 'reasons', 'reviewerNotes', 'internal', 'privateNotes', 'correspondence', 'licenceEvidencePrivate']);
const EVIDENCE_LEVELS = new Set(['demonstrated', 'reported', 'claimed']);
const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;

function walkForForbidden(value, path, errors) {
  if (Array.isArray(value)) { value.forEach((v, i) => walkForForbidden(v, `${path}[${i}]`, errors)); return; }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(k)) errors.push(`forbidden-field:${path}.${k}`);
      walkForForbidden(v, `${path}.${k}`, errors);
    }
  }
}

export function validateBundleContent(bundleBytes) {
  const errors = [];
  if (bundleBytes.length > MAX_BUNDLE_BYTES) return { ok: false, errors: ['bundle-too-large'] };
  let data;
  try { data = JSON.parse(bundleBytes.toString('utf8')); } catch { return { ok: false, errors: ['not-json'] }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, errors: ['not-object'] };

  for (const k of Object.keys(data)) if (!TOP_LEVEL.has(k)) errors.push(`unexpected-top-level:${k}`);
  if (data.schemaVersion !== 1) errors.push('schema-version');
  walkForForbidden(data, '$', errors);

  for (const [i, s] of (data.stories || []).entries()) {
    if (s.status !== 'approved') errors.push(`story-not-approved:${i}`);
    if (!Array.isArray(s.sources) || s.sources.length === 0) errors.push(`story-without-sources:${i}`);
    for (const src of s.sources || []) if (!/^https:\/\//.test(src.url || '')) errors.push(`story-source-url:${i}`);
  }
  for (const [i, c] of (data.classifications || []).entries()) {
    if (!EVIDENCE_LEVELS.has(c.level)) errors.push(`classification-level:${i}`);
    if (!Array.isArray(c.evidence) || c.evidence.length === 0) errors.push(`classification-without-evidence:${i}`);
    if (!c.reviewedBy || !c.reviewedAt) errors.push(`classification-unreviewed:${i}`);
    if (/verified/i.test(c.badgeText || '')) errors.push(`classification-says-verified:${i}`);
  }
  for (const [i, img] of (data.imageCredits || []).entries()) {
    if (img.permissionStatus !== 'verified' || img.demo === true) errors.push(`image-not-verified:${i}`);
  }
  if (data.controls) {
    for (const k of Object.keys(data.controls)) if (!CONTROL_KEYS.has(k)) errors.push(`unexpected-control:${k}`);
    for (const [i, h] of (data.controls.hidden || []).entries()) {
      for (const k of Object.keys(h)) if (k !== 'target' && k !== 'until') errors.push(`hidden-extra-field:${i}.${k}`);
    }
  }
  return { ok: errors.length === 0, errors };
}
