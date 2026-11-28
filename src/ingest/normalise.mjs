// Canonical URLs, validation and quarantine reasons (architecture: missing title,
// bad URL, future date, oversized, parse error, licence mismatch).
import { createHash } from 'node:crypto';

const TRACKING = /^(utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|ref|cmpid|ocid)$/i;
const FUTURE_TOLERANCE_MS = 60 * 60 * 1000;

export function canonicalUrl(raw) {
  let u; try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (u.username || u.password) return null;
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) u.port = '';
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.searchParams.sort();
  let s = u.toString();
  if (s.endsWith('?')) s = s.slice(0, -1);
  return s;
}

export const urlHash = url => createHash('sha256').update(url).digest('hex').slice(0, 20);
// Item links must point at a host the source owns. No public-suffix guessing:
// the "last two labels" shortcut wrongly treats bbc.co.uk and evil.co.uk (or any
// two .org.uk sites) as the same organisation. A link is accepted only if its host
// is the homepage host or one listed in the source's linkHosts, with www. and
// the bare host treated as the same. Subdomains are never implied.
const bare = h => h.toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
export function allowedHosts(source) {
  return new Set([new URL(source.homepage).hostname, ...(source.linkHosts || [])].map(bare));
}
export const hostAllowed = (host, source) => allowedHosts(source).has(bare(host));

// Returns { item } or { quarantine: reason }.
export function normaliseItem(raw, source, now) {
  if (!raw.title || raw.title.length < 3) return { quarantine: 'missing-title' };
  if (raw.title.length > 300 || (raw.summary || '').length > 20_000) return { quarantine: 'oversized' };
  const url = canonicalUrl(raw.link);
  if (!url) return { quarantine: 'bad-url' };
  if (!hostAllowed(new URL(url).hostname, source)) return { quarantine: 'off-domain-link' };
  // A date that is missing or cannot be parsed is quarantined, never replaced with "now".
  const rawDate = raw.publishedRaw ?? raw.published ?? null;
  if (rawDate === null || rawDate === undefined || rawDate === '') return { quarantine: 'missing-date' };
  // The feed parser has already applied strict date rules: a raw date it could not read stays invalid.
  if (raw.publishedRaw && !raw.published) return { quarantine: 'invalid-date' };
  const published = Date.parse(raw.published ?? rawDate);
  if (!Number.isFinite(published) || published < Date.UTC(1990, 0, 1)) return { quarantine: 'invalid-date' };
  if (published > now + FUTURE_TOLERANCE_MS) return { quarantine: 'future-date' };
  return { item: { id: urlHash(url), sourceId: source.id, url, title: raw.title, summary: raw.summary || '', publishedAt: new Date(published).toISOString(), fetchedAt: new Date(now).toISOString() } };
}
