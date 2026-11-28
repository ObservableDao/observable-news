// RSS 2.0, RSS 1.0 (RDF) and Atom → plain items. Output text is plain (no HTML).
import { parseXml, local, child, childrenNamed, textOf, FeedError } from './xml.mjs';

const HTML_ENTITIES = { nbsp: ' ', mdash: '—', ndash: '–', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", copy: '©', reg: '®', trade: '™', pound: '£', euro: '€' };

export function htmlToText(s) {
  return s.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => {
      if (e[0] === '#') { const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ' '; }
      return HTML_ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ').trim();
}

// Strict feed dates: ISO 8601 / RFC 3339 (Atom) or RFC 822 / 1123 (RSS) only, with a
// real calendar day. Date.parse alone is lenient (it accepts "31 Febtember").
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|z|[+-]\d{2}:?\d{2})?$/;
const RFC822 = /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*)?(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{2}|\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{4}|UT|UTC|GMT|Z|[ECMP][SD]T|[A-IK-Z])?$/i;
const realDay = (y, m, d) => d >= 1 && d <= new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
export function parseFeedDate(s) {
  if (!s) return null;
  const t = s.trim();
  let m = ISO.exec(t);
  if (m) { if (+m[2] < 1 || +m[2] > 12 || !realDay(+m[1], +m[2] - 1, +m[3])) return null; }
  else {
    m = RFC822.exec(t);
    if (!m) return null;
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    if (!realDay(y, MONTHS[m[2].toLowerCase()], +m[1])) return null;
  }
  const v = Date.parse(t.replace(/\s+(UT|UTC)$/i, ' GMT'));
  return Number.isFinite(v) ? new Date(v).toISOString() : null;
}
const date = parseFeedDate;

function rssItem(n) {
  const rawDate = textOf(child(n, 'pubDate')) || textOf(child(n, 'date')) || null;
  return {
    publishedRaw: rawDate,
    title: htmlToText(textOf(child(n, 'title'))),
    link: textOf(child(n, 'link')),
    guid: textOf(child(n, 'guid')) || null,
    published: date(rawDate),
    summary: htmlToText(textOf(child(n, 'description')) || textOf(child(n, 'encoded'))),
    author: htmlToText(textOf(child(n, 'creator')) || textOf(child(n, 'author'))) || null,
  };
}

function atomItem(n) {
  const links = childrenNamed(n, 'link');
  const alt = links.find(l => !l.attrs.rel || l.attrs.rel === 'alternate') || links[0];
  const author = child(n, 'author');
  const rawDate = textOf(child(n, 'published')) || textOf(child(n, 'updated')) || null;
  return {
    publishedRaw: rawDate,
    title: htmlToText(textOf(child(n, 'title'))),
    link: alt ? (alt.attrs.href || '').trim() : '',
    guid: textOf(child(n, 'id')) || null,
    published: date(rawDate),
    summary: htmlToText(textOf(child(n, 'summary')) || textOf(child(n, 'content'))),
    author: author ? htmlToText(textOf(child(author, 'name'))) || null : null,
  };
}

export function parseFeed(bytes) {
  const root = parseXml(bytes);
  const kind = local(root.name);
  if (kind === 'rss') {
    const channel = child(root, 'channel');
    if (!channel) throw new FeedError('rss-without-channel');
    return { kind: 'rss', items: childrenNamed(channel, 'item').map(rssItem) };
  }
  if (kind === 'RDF') return { kind: 'rdf', items: childrenNamed(root, 'item').map(rssItem) };
  if (kind === 'feed') return { kind: 'atom', items: childrenNamed(root, 'entry').map(atomItem) };
  throw new FeedError('not-a-feed');
}

// <link rel="alternate" type="application/rss+xml|atom+xml" href="..."> discovery.
export function discoverFeeds(html, baseUrl) {
  const out = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const attr = n => { const a = new RegExp(`${n}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag); return a ? (a[2] ?? a[3]) : ''; };
    if (!/alternate/i.test(attr('rel')) || !/application\/(rss|atom)\+xml/i.test(attr('type'))) continue;
    try { out.push(new URL(attr('href'), baseUrl).toString()); } catch { /* ignore */ }
  }
  return [...new Set(out)];
}
