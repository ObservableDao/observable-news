// Source register: schema, rules and the M0 coverage gate.
// A missing or unclear right counts as "no". The gate is computed from the
// register, never asserted by hand.
import { T, ID, check } from '../content/schema.mjs';

export const SECTIONS = ['uk', 'world', 'science-space', 'technology-ai', 'business'];
export const SECTION_NAMES = { uk: 'UK', world: 'World', 'science-space': 'Science & Space', 'technology-ai': 'Technology & AI', business: 'Business' };
export const RIGHTS = ['fetch', 'analyse', 'group', 'headline', 'excerpt', 'images', 'embed'];
const STATUS = T.oneOf('confirmed', 'pending', 'not-permitted');
const BASIS = T.oneOf('open-licence', 'public-licence-terms', 'published-guidelines', 'written-permission', 'none');

const RIGHT = T.object({ status: STATUS, basis: BASIS, clause: T.text(400), maxChars: T.int(1, 600) }, ['maxChars']);
const NULLABLE_URL = { t: 'nullable-https' };

const SOURCE = T.object({
  id: ID,
  name: T.text(120),
  ownerGroup: ID,
  sourceType: T.oneOf('independent-news', 'government', 'institution', 'company'),
  sections: T.array(T.oneOf(...SECTIONS), { min: 1, max: 5 }),
  homepage: T.https(),
  termsUrl: NULLABLE_URL,
  licence: { t: 'nullable-object', schema: T.object({ id: T.text(60), url: T.https() }) },
  feeds: T.array(T.object({ url: T.https(), discoverFrom: T.https(), verified: T.bool() }, ['url', 'discoverFrom']), { max: 10 }),
  rights: T.object(Object.fromEntries(RIGHTS.map(r => [r, RIGHT]))),
  conditions: T.array(T.text(300), { max: 20 }),
  evidence: T.object({
    termsArchive: T.object({ status: T.oneOf('pending', 'archived'), sha256: T.pattern(/^[0-9a-f]{64}$/, 64), retrievedAt: T.datetime(), url: T.https() }, ['sha256', 'retrievedAt', 'url']),
    writtenPermission: T.object({ status: T.oneOf('not-requested', 'to-send', 'requested', 'granted', 'refused'), ref: T.pattern(/^wp-[a-z0-9-]{3,60}$/, 63) }, ['ref']),
  }),
  contact: T.pattern(/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i, 120),
  summary: T.text(400),
  reviewedBy: ID,
  reviewedAt: T.date(),
  nextReviewAt: T.date(),
}, ['contact']);

const REGISTER = T.object({
  _comment: T.text(600),
  version: T.literal(1),
  assumptions: T.object({ nonCommercial: T.text(300) }),
  sections: T.array(T.oneOf(...SECTIONS), { min: 1, max: 5 }),
  sources: T.array(SOURCE, { min: 1, max: 500 }),
});

// Two small extensions to the strict checker for nullable fields.
function checkExt(schema, value, path, errors) {
  if (schema.t === 'nullable-https') { if (value !== null) check(T.https(), value, path, errors); return; }
  if (schema.t === 'nullable-object') { if (value !== null) check(schema.schema, value, path, errors); return; }
  if (schema.t === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return errors.push(`type-object:${path}`);
    for (const k of Object.keys(value)) if (!(k in schema.props)) errors.push(`unexpected-field:${path}.${k}`);
    for (const [k, sub] of Object.entries(schema.props)) {
      if (!(k in value)) { if (!schema.optional.has(k)) errors.push(`required:${path}.${k}`); continue; }
      checkExt(sub, value[k], `${path}.${k}`, errors);
    }
    return;
  }
  if (schema.t === 'array') {
    if (!Array.isArray(value)) return errors.push(`type-array:${path}`);
    if (value.length < schema.min) errors.push(`min-items:${path}`);
    if (value.length > schema.max) errors.push(`max-items:${path}`);
    value.forEach((v, i) => checkExt(schema.items, v, `${path}[${i}]`, errors));
    return;
  }
  check(schema, value, path, errors);
}

export function validateRegister(reg) {
  const errors = [];
  checkExt(REGISTER, reg, '$', errors);
  if (errors.length) return { ok: false, errors };
  const seen = new Set();
  reg.sources.forEach((s, i) => {
    const p = `$.sources[${i}]`;
    if (seen.has(s.id)) errors.push(`duplicate-id:${p}`); seen.add(s.id);
    for (const r of RIGHTS) {
      const right = s.rights[r];
      if (right.status === 'confirmed' && right.basis === 'none') errors.push(`confirmed-without-basis:${p}.rights.${r}`);
      if (right.status !== 'confirmed' && right.basis !== 'none' && right.basis !== 'written-permission') errors.push(`basis-without-confirmation:${p}.rights.${r}`);
    }
    if (s.rights.excerpt.status === 'confirmed' && !s.rights.excerpt.maxChars) errors.push(`excerpt-without-limit:${p}`);
    for (const r of ['analyse', 'group', 'headline', 'excerpt', 'images']) {
      if (s.rights[r].status === 'confirmed' && s.rights.fetch.status !== 'confirmed') errors.push(`right-without-fetch:${p}.rights.${r}`);
    }
    if (s.rights.excerpt.status === 'confirmed' && s.rights.headline.status !== 'confirmed') errors.push(`excerpt-without-headline:${p}`);
    if (s.rights.headline.status === 'confirmed' && !s.termsUrl) errors.push(`confirmed-without-terms-url:${p}`);
    if (s.rights.headline.status === 'confirmed' && s.feeds.length === 0) errors.push(`confirmed-without-feed:${p}`);
    if (s.rights.headline.status === 'confirmed' && s.rights.headline.basis === 'written-permission' && s.evidence.writtenPermission.status !== 'granted') errors.push(`written-permission-not-granted:${p}`);
    if (s.licence && /NC/.test(s.licence.id) && !reg.assumptions.nonCommercial) errors.push(`nc-licence-without-assumption:${p}`);
    if (s.evidence.termsArchive.status === 'archived' && !(s.evidence.termsArchive.sha256 && s.evidence.termsArchive.retrievedAt)) errors.push(`archive-incomplete:${p}`);
    if (s.nextReviewAt <= s.reviewedAt) errors.push(`review-dates:${p}`);
  });
  return { ok: errors.length === 0, errors };
}

// The M0 gate (architecture doc, M0 acceptance):
//  * at least 3 sources permitting headline display in each launch section;
//  * at least 5 independent news organisations (by ownership group) with
//    confirmed headline rights, across at least 3 sections.
// "strict" counts only sources whose terms are archived with a SHA-256.
export function coverage(reg, { strict = false } = {}) {
  const ok = s => s.rights.headline.status === 'confirmed' && (!strict || s.evidence.termsArchive.status === 'archived');
  const usable = reg.sources.filter(ok);
  const perSection = Object.fromEntries(reg.sections.map(sec => {
    const list = usable.filter(s => s.sections.includes(sec));
    const independent = new Set(list.filter(s => s.sourceType === 'independent-news').map(s => s.ownerGroup));
    return [sec, { sources: list.map(s => s.id), count: list.length, independentGroups: independent.size, meets: list.length >= 3 }];
  }));
  const groups = new Map();
  for (const s of usable.filter(s => s.sourceType === 'independent-news')) {
    const g = groups.get(s.ownerGroup) || { sections: new Set(), sources: [] };
    s.sections.forEach(x => g.sections.add(x)); g.sources.push(s.id); groups.set(s.ownerGroup, g);
  }
  const independentSections = new Set([...groups.values()].flatMap(g => [...g.sections]));
  const independent = { organisations: groups.size, sections: [...independentSections], meets: groups.size >= 5 && independentSections.size >= 3 };
  const pending = reg.sources.filter(s => s.rights.headline.status === 'pending').map(s => s.id);
  const archived = reg.sources.filter(s => s.evidence.termsArchive.status === 'archived').length;
  const sectionsMeeting = reg.sections.filter(sec => perSection[sec].meets);
  return { strict, audited: reg.sources.length, archived, perSection, independent, pending, sectionsMeeting,
    gate: independent.meets && sectionsMeeting.length >= 3 ? (sectionsMeeting.length === reg.sections.length ? 'met' : 'met-with-fewer-sections') : 'not-met' };
}
