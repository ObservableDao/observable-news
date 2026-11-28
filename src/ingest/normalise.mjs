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
const registrable = host => host.split('.').slice(-2).join('.');

// Returns { item } or { quarantine: reason }.
export function normaliseItem(raw, source, now) {
  if (!raw.title || raw.title.length < 3) return { quarantine: 'missing-title' };
  if (raw.title.length > 300 || (raw.summary || '').length > 20_000) return { quarantine: 'oversized' };
  const url = canonicalUrl(raw.link);
  if (!url) return { quarantine: 'bad-url' };
  const host = new URL(url).hostname, home = new URL(source.homepage).hostname;
  if (registrable(host) !== registrable(home)) return { quarantine: 'off-domain-link' };
  const published = raw.published ? Date.parse(raw.published) : now;
  if (published > now + FUTURE_TOLERANCE_MS) return { quarantine: 'future-date' };
  return { item: { id: urlHash(url), sourceId: source.id, url, title: raw.title, summary: raw.summary || '', publishedAt: new Date(published).toISOString(), fetchedAt: new Date(now).toISOString(), dated: !!raw.published } };
}
