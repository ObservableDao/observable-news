// Deterministic synthetic benchmark corpus (architecture test set-up):
// 80 sources, 2,000 items a day, 30 days of history, recorded feed responses,
// story clusters across publishers, and canary headlines without display rights.
// Everything is labelled synthetic; nothing here is real news.
import { canonicalUrl, urlHash } from '../src/ingest/normalise.mjs';

export function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const WORDS = 'council budget minister ministry vote parliament committee report energy prices inflation rates bank exports rail strike hospital waiting lists climate flood storm wildfire drought satellite launch telescope mission orbit rover research study vaccine trial genome species forest ocean coral election coalition border treaty sanctions ceasefire talks summit court ruling appeal inquiry regulator fine data privacy chip startup model safety software outage network cable housing rent schools exams teachers police prison water sewage farmers harvest wages jobs unemployment growth factory steel airport runway defence frigate drone aircraft'.split(' ');
const SECTIONS = ['uk', 'world', 'science-space', 'technology-ai', 'business'];
export const CANARY = 'CANARY-NO-DISPLAY-RIGHTS';

function makeRegister(r) {
  const sources = [];
  for (let i = 0; i < 80; i++) {
    const headline = i % 10 !== 9;                                  // 10% have no display rights (canaries)
    const excerpt = headline && i % 3 === 0;
    const C = (ok, extra = {}) => ok ? { status: 'confirmed', basis: 'open-licence', clause: 'synthetic', ...extra } : { status: 'pending', basis: 'none', clause: 'synthetic' };
    sources.push({
      id: `src-${String(i).padStart(2, '0')}`, name: `Synthetic Source ${i}`, ownerGroup: `owner-${Math.floor(i / 2)}`,
      sourceType: i % 4 === 0 ? 'government' : 'independent-news', sections: [SECTIONS[i % 5], SECTIONS[(i + 2) % 5]],
      homepage: `https://src-${i}.example.org/`, termsUrl: `https://src-${i}.example.org/terms`, licence: null,
      feeds: [{ url: `https://src-${i}.example.org/feed.xml`, verified: false }],
      rights: { fetch: C(true), analyse: C(true), group: C(i % 7 !== 0), headline: C(headline), excerpt: C(excerpt, { maxChars: 280 }), images: C(false), embed: C(false) },
      conditions: [], evidence: { termsArchive: { status: 'pending' }, writtenPermission: { status: 'not-requested' } },
      summary: 'synthetic', reviewedBy: 'bench', reviewedAt: '2026-11-28', nextReviewAt: '2027-05-28',
    });
  }
  void r;
  return { _comment: 'synthetic', version: 1, assumptions: { nonCommercial: 'synthetic' }, sections: SECTIONS, sources };
}

// Items for [start, end): 2,000 a day spread over 80 sources, 35% in multi-source stories.
export function makeTimeline({ start, end, seed = 42, perDay = 2000 }) {
  const r = rng(seed), reg = makeRegister(r);
  const n = Math.round(perDay * (end - start) / 86400_000);
  const items = [];
  let story = null;
  for (let k = 0; k < n; k++) {
    const t = start + Math.floor((k / n) * (end - start));
    const si = Math.floor(r() * 80), s = reg.sources[si];
    let title;
    if (story && r() < 0.35 && story.left-- > 0) title = r() < 0.7 ? story.title : story.title.toUpperCase();
    else {
      const w = Array.from({ length: 7 + Math.floor(r() * 5) }, () => WORDS[Math.floor(r() * WORDS.length)]);
      title = w.join(' ').replace(/^./, c => c.toUpperCase()) + ` ${k}`;
      if (r() < 0.25) story = { title, left: 2 + Math.floor(r() * 6) };
    }
    if (s.rights.headline.status !== 'confirmed') title = `${CANARY} ${title}`;
    const link = `https://src-${si}.example.org/news/${k}?utm_source=rss`;
    items.push({ source: s, title, link, summary: `Synthetic summary ${k}. ` + 'Lorem ipsum dolor sit amet, synthetic benchmark text only. '.repeat(6), published: new Date(t).toISOString(), k });
  }
  return { register: reg, items };
}

const escXml = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
export function rssFor(source, items) {
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>${escXml(source.name)}</title><link>${source.homepage}</link>` +
    items.map(it => `<item><title>${escXml(it.title)}</title><link>${escXml(it.link)}</link><guid isPermaLink="false">${it.k}</guid><pubDate>${new Date(it.published).toUTCString()}</pubDate><description><![CDATA[<p>${it.summary}</p>]]></description><dc:creator>Synthetic Author</dc:creator></item>`).join('') +
    '</channel></rss>';
}

// Recorded responses at time `at`: each feed holds its 50 newest items.
// `unchangedShare` of feeds answer 304, as conditional GETs would.
export function recordedResponses(timeline, at, { perFeed = 50, unchangedShare = 0.5, seed = 7 } = {}) {
  const r = rng(seed), bySource = new Map();
  for (const it of timeline.items) if (Date.parse(it.published) <= at) { const l = bySource.get(it.source.id) || []; l.push(it); bySource.set(it.source.id, l); }
  const out = new Map();
  for (const s of timeline.register.sources) {
    const list = (bySource.get(s.id) || []).slice(-perFeed).reverse();
    out.set(s.id, r() < unchangedShare ? { status: 304 } : { status: 200, body: Buffer.from(rssFor(s, list)), etag: `"${s.id}-${at}"` });
  }
  return out;
}

// 12 months of archive inputs: 5,000 group pages, 300 explainers, 365 editions.
export function archiveInputs({ groups = 5000, explainers = 300, editions = 365, seed = 99 } = {}) {
  const r = rng(seed);
  const title = () => Array.from({ length: 8 }, () => WORDS[Math.floor(r() * WORDS.length)]).join(' ');
  const source = { name: 'Synthetic Source', sourceType: 'independent-news', rights: { headline: { status: 'confirmed' }, excerpt: { status: 'confirmed' } } };
  const item = k => ({ title: `Synthetic headline ${k} ${title()}`, excerpt: r() < 0.3 ? 'Synthetic excerpt text. '.repeat(8) : null, url: `https://src-${k % 80}.example.org/n/${k}`, source, publishedAt: '2026-06-01T08:00:00.000Z' });
  return {
    groups: Array.from({ length: groups }, (_, i) => ({ id: `a${i}`, title: `Synthetic story ${i}: ${title()}`, items: Array.from({ length: 2 + Math.floor(r() * 7) }, (_, j) => item(i * 10 + j)) })),
    explainers: Array.from({ length: explainers }, (_, i) => ({ id: `e${i}`, title: `Synthetic explainer ${i}`, paragraphs: Array.from({ length: 12 }, () => 'Synthetic explainer paragraph for benchmarking only. '.repeat(5)) })),
    editions: Array.from({ length: editions }, (_, i) => ({ date: new Date(Date.UTC(2025, 11, 1) + i * 86400_000).toISOString().slice(0, 10), items: Array.from({ length: 30 }, (_, j) => item(i * 100 + j)) })),
  };
}
export { canonicalUrl, urlHash };
