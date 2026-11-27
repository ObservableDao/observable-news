// Public-side content validation for approved bundles (schemaVersion 1).
// Runs on EVERY bundle, even one with a valid signature: on GitHub Free the
// private repository has no enforced branch protection, so a status string
// such as "approved" proves nothing. Every publishable record must carry its
// own evidence (source permissions, references, classification evidence,
// image licence and attribution), and every cross-reference must resolve.
import { T, ID, HANDLE, SHA256, EVIDENCE_ID, check } from '../content/schema.mjs';

export const MAX_BUNDLE_BYTES = 5 * 1024 * 1024;
const SKEW_MS = 5 * 60 * 1000;

// Keys that must never leave the private repository, at any depth.
const FORBIDDEN_KEYS = new Set(['draft', 'drafts', 'notes', 'note', 'reason', 'reasons', 'reviewerNotes', 'internal',
  'privateNotes', 'correspondence', 'licenceEvidencePrivate']);

const REVIEW = T.object({ status: T.literal('reviewed'), reviewedBy: HANDLE, reviewedAt: T.datetime() });

// Source permission: what we may show from this source, and the evidence for it.
// The evidence itself stays private; the bundle carries its id and hash.
const PERMISSION = T.object({
  basis: T.oneOf('licence', 'publisher-terms', 'written-permission', 'link-and-headline-only'),
  rights: T.object({ headline: T.bool(), summary: T.bool(), quote: T.bool(), image: T.bool() }),
  evidenceId: EVIDENCE_ID,
  evidenceSha256: SHA256,
  checkedBy: HANDLE,
  checkedAt: T.datetime(),
  expiresAt: T.datetime(),
}, ['expiresAt']);

const SOURCE = T.object({ id: ID, publisher: T.text(120), url: T.https(), date: T.date(), permission: PERMISSION });

const STORY = T.object({
  id: ID,
  status: T.literal('approved'),
  headline: T.text(200),
  headlineSourceId: ID,          // the source whose text the headline is; its own rights apply
  summary: T.text(1200),
  summarySourceId: ID,           // required whenever summary is present
  sources: T.array(SOURCE, { min: 1, max: 20 }),
  imageId: ID,
  approval: T.object({ method: T.oneOf('automated-rules', 'editor'), by: HANDLE, at: T.datetime() }),
}, ['summary', 'summarySourceId', 'imageId']);

const REFERENCE = T.object({ title: T.text(200), publisher: T.text(120), url: T.https(), accessedAt: T.date() });

const EXPLAINER = T.object({
  id: ID,
  title: T.text(200),
  body: T.text(8000),
  references: T.array(REFERENCE, { min: 1, max: 30 }),
  relatedStoryIds: T.array(ID, { max: 20 }),
  review: REVIEW,
}, ['relatedStoryIds']);

const EVIDENCE_ITEM = T.object({
  type: T.oneOf('primary-document', 'official-statement', 'news-report', 'dataset', 'video', 'other'),
  publisher: T.text(120),
  url: T.https(),
  date: T.date(),
  excerpt: T.text(300),
  retrievedAt: T.datetime(),
});

const CLASSIFICATION = T.object({
  id: ID,
  target: ID,
  claim: T.text(300),
  level: T.oneOf('demonstrated', 'reported', 'claimed'),
  badgeText: T.text(80),
  origin: T.oneOf('ai-assisted', 'editor'),
  evidence: T.array(EVIDENCE_ITEM, { min: 1, max: 20 }),
  review: REVIEW,
});

const IMAGE = T.object({
  id: ID,
  src: T.https(),
  alt: T.text(300),
  verified: T.literal(true),
  licence: T.object({ name: T.text(120), url: T.https() }),
  attribution: T.object({ creator: T.text(120), sourceUrl: T.https(), creditLine: T.text(200) }),
  permission: T.object({ evidenceId: EVIDENCE_ID, evidenceSha256: SHA256, checkedBy: HANDLE, checkedAt: T.datetime() }),
});

const CORRECTION = T.object({
  id: ID, targetId: ID, kind: T.oneOf('correction', 'clarification', 'update'), text: T.text(1000), correctedAt: T.datetime(),
});

const CONTROLS = T.object({
  featured: T.array(ID, { max: 20 }),
  hidden: T.array(T.object({ target: T.pattern(/^(item|story|source):[a-z0-9-]{1,80}$/, 90), until: T.date() }), { max: 500 }),
  grouping: T.array(T.object({ id: ID, label: T.text(120), storyIds: T.array(ID, { min: 2, max: 50 }) }), { max: 100 }),
});

export const BUNDLE_SCHEMA = T.object({
  schemaVersion: T.literal(1),
  stories: T.array(STORY, { max: 2000 }),
  explainers: T.array(EXPLAINER, { max: 500 }),
  classifications: T.array(CLASSIFICATION, { max: 5000 }),
  images: T.array(IMAGE, { max: 2000 }),
  corrections: T.array(CORRECTION, { max: 2000 }),
  controls: CONTROLS,
});

function walkForForbidden(value, path, errors) {
  if (Array.isArray(value)) { value.forEach((v, i) => walkForForbidden(v, `${path}[${i}]`, errors)); return; }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(k)) errors.push(`forbidden-field:${path}.${k}`);
      walkForForbidden(v, `${path}.${k}`, errors);
    }
  }
}

// Rules that a per-field schema cannot express. Only run on schema-valid data.
function semanticChecks(d, now, errors) {
  const future = t => Date.parse(t) > now + SKEW_MS;
  const ids = new Map();
  const claim = (id, path) => { if (ids.has(id)) errors.push(`duplicate-id:${path}`); else ids.set(id, path); };
  d.stories.forEach((s, i) => claim(s.id, `$.stories[${i}]`));
  d.explainers.forEach((e, i) => claim(e.id, `$.explainers[${i}]`));
  d.classifications.forEach((c, i) => claim(c.id, `$.classifications[${i}]`));
  d.images.forEach((m, i) => claim(m.id, `$.images[${i}]`));
  d.corrections.forEach((c, i) => claim(c.id, `$.corrections[${i}]`));
  d.controls.grouping.forEach((g, i) => claim(g.id, `$.controls.grouping[${i}]`));

  const stories = new Set(d.stories.map(s => s.id));
  const explainers = new Set(d.explainers.map(e => e.id));
  const images = new Set(d.images.map(m => m.id));
  const content = new Set([...stories, ...explainers]);

  d.stories.forEach((s, i) => {
    const p = `$.stories[${i}]`;
    if (future(s.approval.at)) errors.push(`in-future:${p}.approval.at`);
    if (s.imageId && !images.has(s.imageId)) errors.push(`dangling-image:${p}.imageId`);
    // Each displayed publisher-owned text field is bound to exactly one source,
    // and only THAT source's recorded rights count. Another publisher's
    // permission never covers it.
    const byId = new Map();
    s.sources.forEach((src, j) => { if (byId.has(src.id)) errors.push(`duplicate-source-id:${p}.sources[${j}]`); else byId.set(src.id, src); });
    const owner = s.headlineSourceId && byId.get(s.headlineSourceId);
    if (!owner) errors.push(`dangling-source:${p}.headlineSourceId`);
    else if (!owner.permission.rights.headline) errors.push(`headline-without-permission:${p}.headlineSourceId`);
    if (s.summary !== undefined) {
      if (s.summarySourceId === undefined) errors.push(`required:${p}.summarySourceId`);
      else {
        const so = byId.get(s.summarySourceId);
        if (!so) errors.push(`dangling-source:${p}.summarySourceId`);
        else if (!so.permission.rights.summary) errors.push(`summary-without-permission:${p}.summarySourceId`);
      }
    } else if (s.summarySourceId !== undefined) errors.push(`summary-source-without-summary:${p}.summarySourceId`);
    s.sources.forEach((src, j) => {
      const q = `${p}.sources[${j}].permission`, perm = src.permission;
      if (perm.basis === 'link-and-headline-only' && (perm.rights.summary || perm.rights.quote || perm.rights.image)) errors.push(`rights-exceed-basis:${q}`);
      if (future(perm.checkedAt)) errors.push(`in-future:${q}.checkedAt`);
      if (perm.expiresAt && Date.parse(perm.expiresAt) <= now) errors.push(`permission-expired:${q}`);
    });
  });
  d.explainers.forEach((e, i) => {
    if (future(e.review.reviewedAt)) errors.push(`in-future:$.explainers[${i}].review.reviewedAt`);
    (e.relatedStoryIds || []).forEach((id, j) => { if (!stories.has(id)) errors.push(`dangling-story:$.explainers[${i}].relatedStoryIds[${j}]`); });
  });
  d.classifications.forEach((c, i) => {
    const p = `$.classifications[${i}]`;
    if (!content.has(c.target)) errors.push(`dangling-target:${p}.target`);
    if (/verif/i.test(c.badgeText)) errors.push(`badge-says-verified:${p}.badgeText`);
    if (future(c.review.reviewedAt)) errors.push(`in-future:${p}.review.reviewedAt`);
    c.evidence.forEach((e, j) => { if (future(e.retrievedAt)) errors.push(`in-future:${p}.evidence[${j}].retrievedAt`); });
  });
  d.images.forEach((m, i) => { if (future(m.permission.checkedAt)) errors.push(`in-future:$.images[${i}].permission.checkedAt`); });
  d.corrections.forEach((c, i) => { if (!content.has(c.targetId)) errors.push(`dangling-target:$.corrections[${i}].targetId`); });
  d.controls.featured.forEach((id, i) => { if (!content.has(id)) errors.push(`dangling-target:$.controls.featured[${i}]`); });
  d.controls.grouping.forEach((g, i) => g.storyIds.forEach((id, j) => { if (!stories.has(id)) errors.push(`dangling-story:$.controls.grouping[${i}].storyIds[${j}]`); }));
}

export function validateBundleContent(bundleBytes, { now = Date.now() } = {}) {
  if (bundleBytes.length > MAX_BUNDLE_BYTES) return { ok: false, errors: ['bundle-too-large'] };
  let data;
  try { data = JSON.parse(bundleBytes.toString('utf8')); } catch { return { ok: false, errors: ['not-json'] }; }
  const errors = [];
  walkForForbidden(data, '$', errors);
  check(BUNDLE_SCHEMA, data, '$', errors);
  if (errors.length === 0) semanticChecks(data, now, errors);
  return { ok: errors.length === 0, errors };
}
