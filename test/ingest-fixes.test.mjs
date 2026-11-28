// Regression tests for the review findings on PR #8 (one group per finding).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFetcher, fetchSourceWith, robotsAllows } from '../src/ingest/fetcher.mjs';
import { collect, emptyState, RETENTION_DAYS } from '../src/ingest/collect.mjs';
import { normaliseItem, hostAllowed } from '../src/ingest/normalise.mjs';
import { parseFeed } from '../src/ingest/feed.mjs';

const NOW = Date.parse('2026-11-28T12:00:00Z');
const day = 86400e3;

// A fake web: url -> { status, headers?, body? } or 'network-error'. Records every request.
function fakeWeb(routes) {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    const r = routes[url];
    if (r === undefined) return new Response('not found', { status: 404 });
    if (r === 'network-error') throw Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' });
    return new Response(r.body ?? null, { status: r.status, headers: r.headers || {} });
  };
  return { requests, fetcher: createFetcher({ fetchImpl }) };
}
const rss = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title>${items.map(([t, l, d]) => `<item><title>${t}</title><link>${l}</link>${d === undefined ? '' : `<pubDate>${d}</pubDate>`}</item>`).join('')}</channel></rss>`;
const SRC = (over = {}) => ({ id: 's', name: 'S', homepage: 'https://news.example.co.uk/', sourceType: 'independent-news', ownerGroup: 'o', sections: ['uk'],
  feeds: [{ url: 'https://news.example.co.uk/feed.xml', verified: true }],
  rights: { fetch: { status: 'confirmed' }, analyse: { status: 'confirmed' }, group: { status: 'confirmed' }, headline: { status: 'confirmed' }, excerpt: { status: 'pending' }, images: { status: 'pending' }, embed: { status: 'pending' } }, ...over });

// ---------- 1. robots.txt before every feed request, honouring redirects and disallow rules
test('F1a a disallowed feed is never requested; only robots.txt is', async () => {
  const { requests, fetcher } = fakeWeb({ 'https://news.example.co.uk/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /feed' } });
  const r = await fetcher.get('https://news.example.co.uk/feed.xml');
  assert.equal(r.status, 'blocked');
  assert.deepEqual(requests, ['https://news.example.co.uk/robots.txt']);
});
test('F1b a rule naming our agent overrides "*"', async () => {
  const txt = 'User-agent: *\nAllow: /\n\nUser-agent: ObservableNewsM0\nDisallow: /';
  assert.equal(robotsAllows(txt, 'ObservableNewsM0', '/feed.xml'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /private\nAllow: /private/feed', 'ObservableNewsM0', '/private/feed'), true);
});
test('F1c a redirect to a disallowed path is not followed', async () => {
  const { requests, fetcher } = fakeWeb({
    'https://news.example.co.uk/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /secret' },
    'https://news.example.co.uk/feed.xml': { status: 301, headers: { location: '/secret/feed.xml' } },
  });
  const r = await fetcher.get('https://news.example.co.uk/feed.xml');
  assert.equal(r.status, 'blocked');
  assert.ok(!requests.includes('https://news.example.co.uk/secret/feed.xml'));
});
test('F1d a redirect to another host checks that host\'s robots.txt first', async () => {
  const { requests, fetcher } = fakeWeb({
    'https://news.example.co.uk/robots.txt': { status: 200, body: 'User-agent: *\nAllow: /' },
    'https://news.example.co.uk/feed.xml': { status: 302, headers: { location: 'https://cdn.example.net/feed.xml' } },
    'https://cdn.example.net/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /' },
  });
  const r = await fetcher.get('https://news.example.co.uk/feed.xml');
  assert.equal(r.status, 'blocked');
  assert.deepEqual(requests, ['https://news.example.co.uk/robots.txt', 'https://news.example.co.uk/feed.xml', 'https://cdn.example.net/robots.txt']);
});
test('F1e RFC 9309: 4xx robots.txt allows; 5xx or unreachable disallows; robots.txt redirects are followed', async () => {
  const a = fakeWeb({ 'https://a.example.org/feed': { status: 200, body: 'ok' } });
  assert.equal((await a.fetcher.get('https://a.example.org/feed')).status, 200, '404 robots.txt = no restrictions');
  const b = fakeWeb({ 'https://b.example.org/robots.txt': { status: 503 } });
  assert.equal((await b.fetcher.get('https://b.example.org/feed')).status, 'blocked');
  assert.ok(!b.requests.includes('https://b.example.org/feed'));
  const c = fakeWeb({ 'https://c.example.org/robots.txt': 'network-error' });
  assert.equal((await c.fetcher.get('https://c.example.org/feed')).status, 'blocked');
  const d = fakeWeb({ 'https://d.example.org/robots.txt': { status: 301, headers: { location: 'https://www.d.example.org/robots.txt' } }, 'https://www.d.example.org/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /' } });
  assert.equal((await d.fetcher.get('https://d.example.org/feed')).status, 'blocked');
});
test('F1f robots.txt is fetched once per origin; redirect loops and odd schemes stop', async () => {
  const { requests, fetcher } = fakeWeb({ 'https://e.example.org/robots.txt': { status: 200, body: '' }, 'https://e.example.org/1': { status: 200, body: '1' }, 'https://e.example.org/2': { status: 200, body: '2' }, 'https://e.example.org/loop': { status: 302, headers: { location: '/loop' } } });
  await fetcher.get('https://e.example.org/1'); await fetcher.get('https://e.example.org/2');
  assert.equal(requests.filter(u => u.endsWith('robots.txt')).length, 1);
  assert.equal((await fetcher.get('https://e.example.org/loop')).code, 'too-many-redirects');
  assert.equal((await fetcher.get('ftp://e.example.org/x')).code, 'bad-scheme');
});
test('F1g a collection run marks a robots-blocked source and carries on', async () => {
  const { fetcher } = fakeWeb({ 'https://news.example.co.uk/robots.txt': { status: 200, body: 'User-agent: *\nDisallow: /' } });
  const r = await collect({ register: { sources: [SRC()] }, state: emptyState(), fetchSource: fetchSourceWith(fetcher), now: NOW });
  assert.deepEqual([r.stats.blocked, r.state.sources.s.health], [1, 'blocked']);
});
test('F1h the live benchmark goes through the polite fetcher only', () => {
  const src = readFileSync(new URL('../scripts/bench-live.mjs', import.meta.url), 'utf8');
  assert.ok(/createFetcher\(\)/.test(src) && !/[^.]fetch\(/.test(src.replace(/fetcher\.get|createFetcher|fetchSourceWith/g, '')), 'no direct fetch() calls');
});

// ---------- 2. 14-day retention is the actual default
test('F2 collection prunes after 14 days by default', async () => {
  assert.equal(RETENTION_DAYS, 14);
  const feed = rss([['Fifteen days old item', 'https://news.example.co.uk/a', new Date(NOW - 15 * day).toUTCString()], ['Thirteen days old item', 'https://news.example.co.uk/b', new Date(NOW - 13 * day).toUTCString()]]);
  const r = await collect({ register: { sources: [SRC()] }, state: emptyState(), fetchSource: async () => ({ status: 200, body: Buffer.from(feed) }), now: NOW });
  assert.deepEqual([r.stats.newItems, r.stats.stale], [1, 1]);
});

// ---------- 3. Correct source-domain validation (.co.uk, .org.uk)
test('F3 links must be on the source\'s own host, not merely the same public suffix', () => {
  const s = SRC();
  assert.equal(hostAllowed('news.example.co.uk', s), true);
  assert.equal(hostAllowed('www.news.example.co.uk', s), true, 'www. and bare host are the same');
  assert.equal(hostAllowed('evil.co.uk', s), false, 'the old last-two-labels check accepted this');
  assert.equal(hostAllowed('other.example.co.uk', s), false, 'subdomains are never implied');
  const org = SRC({ homepage: 'https://libertyinvestigates.org.uk/' });
  assert.equal(hostAllowed('libertyinvestigates.org.uk', org), true);
  assert.equal(hostAllowed('impostor.org.uk', org), false);
  assert.equal(hostAllowed('science.feedback.org', SRC({ homepage: 'https://climatefeedback.org/', linkHosts: ['science.feedback.org'] })), true, 'extra hosts must be listed explicitly');
  const n = normaliseItem({ title: 'A real title', link: 'https://evil.co.uk/x', published: '2026-11-27T09:00:00Z' }, s, NOW);
  assert.equal(n.quarantine, 'off-domain-link');
});

// ---------- 4. Invalid publication dates are quarantined without crashing a run
test('F4a invalid and missing dates are quarantined, never replaced with "now"', () => {
  const s = SRC(), base = { title: 'A real title', link: 'https://news.example.co.uk/a' };
  assert.equal(normaliseItem({ ...base, published: 'not a date' }, s, NOW).quarantine, 'invalid-date');
  assert.equal(normaliseItem({ ...base, publishedRaw: 'Fri, 31 Febtember 2026', published: null }, s, NOW).quarantine, 'invalid-date');
  assert.equal(normaliseItem({ ...base, published: '1970-01-01T00:00:00Z' }, s, NOW).quarantine, 'invalid-date');
  assert.equal(normaliseItem(base, s, NOW).quarantine, 'missing-date');
  assert.doesNotThrow(() => normaliseItem({ ...base, published: '+999999-01-01T00:00:00Z' }, s, NOW));
});
test('F4c strict feed dates: real RSS and Atom forms pass, lenient or impossible forms do not', async () => {
  const { parseFeedDate } = await import('../src/ingest/feed.mjs');
  for (const ok of ['Fri, 27 Nov 2026 09:00:00 GMT', '27 Nov 2026 09:00 +0000', 'Fri, 27 Nov 2026 09:00:00 EST', '2026-11-27T09:00:00Z', '2026-11-27T09:00:00.123+01:00', '2026-11-27']) assert.ok(parseFeedDate(ok), ok);
  for (const bad of ['Fri, 31 Febtember 2026', 'Fri, 31 Feb 2026 09:00:00 GMT', '2026-02-30T00:00:00Z', '2026-13-01', 'yesterday', 'Nov 27 2026', '']) assert.equal(parseFeedDate(bad), null, bad);
});

test('F4b one bad date in a feed does not stop the rest of the run', async () => {
  const feed = rss([['Good item one', 'https://news.example.co.uk/1', new Date(NOW - day).toUTCString()], ['Bad date item', 'https://news.example.co.uk/2', 'yesterday-ish'], ['Undated item', 'https://news.example.co.uk/3', undefined], ['Good item two', 'https://news.example.co.uk/4', new Date(NOW - 2 * day).toUTCString()]]);
  assert.equal(parseFeed(Buffer.from(feed)).items[1].publishedRaw, 'yesterday-ish');
  const r = await collect({ register: { sources: [SRC()] }, state: emptyState(), fetchSource: async () => ({ status: 200, body: Buffer.from(feed) }), now: NOW });
  assert.equal(r.stats.newItems, 2);
  assert.deepEqual([r.state.quarantine['invalid-date'], r.state.quarantine['missing-date']], [1, 1]);
});

// ---------- 5. Group ids stay unique across retained history
test('F5 group ids never repeat, even after more than 48 hours without collection', async () => {
  const TITLES = ['Council approves new budget for schools', 'Telescope spots water on distant moon', 'Rail strike halts services across north', 'Bank holds interest rates for winter', 'Storm floods coastal villages overnight',
    'Parliament debates housing reform bill', 'Startup unveils battery recycling plant', 'Hospital waiting lists fall in spring', 'Farmers report record apple harvest', 'Regulator fines water company heavily'];
  const feedAt = (t, n, off) => rss(Array.from({ length: n }, (_, i) => [TITLES[off + i], `https://news.example.co.uk/${t}/${i}`, new Date(t - i * 60e3).toUTCString()]));
  let st = emptyState();
  const t1 = NOW - 5 * day;
  st = (await collect({ register: { sources: [SRC()] }, state: st, fetchSource: async () => ({ status: 200, body: Buffer.from(feedAt(t1, 5, 0)) }), now: t1 })).state;
  const before = structuredClone(st.groups);
  const t2 = NOW;                                           // 5 days later: nothing in the 48-hour window
  st = (await collect({ register: { sources: [SRC()] }, state: st, fetchSource: async () => ({ status: 200, body: Buffer.from(feedAt(t2, 5, 5)) }), now: t2 })).state;
  for (const [id, g] of Object.entries(before)) assert.deepEqual(st.groups[id], g, `old group ${id} was overwritten`);
  const ids = Object.keys(st.groups);
  assert.equal(new Set(ids).size, 10);
  assert.equal(st.nextGroupId, 11);
  const itemsPerGroup = {}; for (const it of Object.values(st.items)) itemsPerGroup[it.groupId] = (itemsPerGroup[it.groupId] || 0) + 1;
  assert.ok(Object.values(itemsPerGroup).every(n => n === 1), 'no new item was merged into an old group by id collision');
});
test('F5b a state without the counter (older format) still continues above its highest id', async () => {
  const st = emptyState(); delete st.nextGroupId; st.groups = { g7: { id: 'g7', firstSeen: '2026-11-01T00:00:00.000Z', lastSeen: '2026-11-20T00:00:00.000Z', itemCount: 1, publishers: 1 } };
  const feed = rss([['A brand new story here', 'https://news.example.co.uk/new', new Date(NOW - 3600e3).toUTCString()]]);
  const r = await collect({ register: { sources: [SRC()] }, state: st, fetchSource: async () => ({ status: 200, body: Buffer.from(feed) }), now: NOW });
  assert.equal(Object.values(r.state.items)[0].groupId, 'g8');
});

// ---------- 6. Live publisher requests only from a manual run on main
test('F6 the benchmark workflow keeps synthetic checks on PRs and live requests on manual main runs', () => {
  const wf = readFileSync(new URL('../.github/workflows/benchmark.yml', import.meta.url), 'utf8');
  const live = wf.slice(wf.indexOf('\n  live:'));
  const fixtures = wf.slice(wf.indexOf('\n  fixtures:'), wf.indexOf('\n  live:'));
  assert.match(live, /if: github\.event_name == 'workflow_dispatch' && github\.ref == 'refs\/heads\/main'/);
  assert.ok(!/if:/.test(fixtures.split('steps:')[0]), 'fixtures run on pull requests');
  assert.match(wf, /pull_request:/);
  assert.ok(!/bench-live/.test(fixtures), 'the PR job never contacts publishers');
});
