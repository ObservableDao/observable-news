// Ingestion pipeline: feed safety, parsing, normalisation, rights, grouping, collection, rendering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseXml } from '../src/ingest/xml.mjs';
import { parseFeed, discoverFeeds, htmlToText } from '../src/ingest/feed.mjs';
import { canonicalUrl, normaliseItem } from '../src/ingest/normalise.mjs';
import { applyRights, truncateExcerpt } from '../src/ingest/rights.mjs';
import { simhash, hamming, Grouper } from '../src/ingest/group.mjs';
import { collect, emptyState } from '../src/ingest/collect.mjs';
import { renderLive, esc } from '../src/build/render.mjs';
import { makeTimeline, rssFor, recordedResponses, CANARY } from '../bench/fixtures.mjs';

const NOW = Date.parse('2026-11-28T12:00:00Z');
const SRC = { id: 's', name: 'S', homepage: 'https://news.example.org/', sourceType: 'independent-news', ownerGroup: 'o', sections: ['uk'],
  rights: { fetch: { status: 'confirmed' }, analyse: { status: 'confirmed' }, group: { status: 'confirmed' }, headline: { status: 'confirmed' }, excerpt: { status: 'confirmed', maxChars: 40 }, images: { status: 'pending' }, embed: { status: 'pending' } } };
const RSS = `<?xml version="1.0"?><rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>T</title>
<item><title>Rates &amp; prices rise</title><link>https://news.example.org/a?utm_source=rss&amp;id=2#top</link><pubDate>Fri, 27 Nov 2026 09:00:00 GMT</pubDate><description><![CDATA[<p>Hello <b>world</b> &mdash; ok</p>]]></description><dc:creator>A. Writer</dc:creator></item>
</channel></rss>`;

test('I1 DTDs, entity declarations and other declarations are refused', () => {
  assert.throws(() => parseXml('<!DOCTYPE x [<!ENTITY a "b">]><rss/>'), { code: 'dtd-not-allowed' });
  assert.throws(() => parseXml('<rss><!ELEMENT x ANY></rss>'), { code: 'declaration-not-allowed' });
  assert.throws(() => parseXml('<a>' + '<b>'.repeat(70) + '</a>'), { code: 'too-deep' });
  assert.throws(() => parseXml(Buffer.alloc(5 * 1024 * 1024 + 1, 'a')), { code: 'feed-too-large' });
  assert.equal(parseXml('<a>&unknown;</a>').text, '&unknown;', 'unknown entities are not expanded');
});

test('I2 RSS, Atom and RDF feeds parse to plain text', () => {
  const r = parseFeed(Buffer.from(RSS)).items[0];
  assert.deepEqual([r.title, r.summary, r.author, r.published], ['Rates & prices rise', 'Hello world — ok', 'A. Writer', '2026-11-27T09:00:00.000Z']);
  const atom = parseFeed(Buffer.from('<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="html">A &lt;b&gt;bold&lt;/b&gt; claim</title><link rel="alternate" href="https://news.example.org/b"/><id>x</id><updated>2026-11-27T10:00:00Z</updated><summary>S</summary></entry></feed>')).items[0];
  assert.deepEqual([atom.title, atom.link], ['A bold claim', 'https://news.example.org/b']);
  assert.equal(parseFeed(Buffer.from('<rdf:RDF xmlns:rdf="r"><item><title>R one</title><link>https://news.example.org/r</link></item></rdf:RDF>')).kind, 'rdf');
  assert.throws(() => parseFeed(Buffer.from('<html><body/></html>')), { code: 'not-a-feed' });
  assert.equal(htmlToText('<script>alert(1)</script>Safe'), 'Safe');
});

test('I3 feed discovery reads alternate links only', () => {
  const html = '<link rel="alternate" type="application/rss+xml" href="/feed/"><link rel="stylesheet" href="/s.css"><link rel="alternate" type="application/atom+xml" href="https://x.example/atom">';
  assert.deepEqual(discoverFeeds(html, 'https://news.example.org/'), ['https://news.example.org/feed/', 'https://x.example/atom']);
});

test('I4 canonical URLs drop tracking and fragments; bad items are quarantined', () => {
  assert.equal(canonicalUrl('HTTPS://News.Example.org:443/a?utm_source=rss&id=2#top'), 'https://news.example.org/a?id=2');
  assert.equal(canonicalUrl('javascript:alert(1)'), null);
  const raw = { title: 'Ok title', link: 'https://news.example.org/a', published: '2026-11-27T09:00:00Z', summary: '' };
  assert.ok(normaliseItem(raw, SRC, NOW).item);
  assert.equal(normaliseItem({ ...raw, title: '' }, SRC, NOW).quarantine, 'missing-title');
  assert.equal(normaliseItem({ ...raw, link: 'https://elsewhere.example.com/x' }, SRC, NOW).quarantine, 'off-domain-link');
  assert.equal(normaliseItem({ ...raw, published: '2026-11-29T12:00:00Z' }, SRC, NOW).quarantine, 'future-date');
  assert.equal(normaliseItem({ ...raw, link: 'ftp://news.example.org/a' }, SRC, NOW).quarantine, 'bad-url');
});

test('I5 rights: no headline, excerpt or grouping text without the right', () => {
  const item = normaliseItem({ title: 'A headline here', link: 'https://news.example.org/a', published: '2026-11-27T09:00:00Z', summary: 'One two three four five six seven eight nine ten eleven twelve' }, SRC, NOW).item;
  const ok = applyRights(item, SRC);
  assert.equal(ok.display.headline, 'A headline here');
  assert.ok(ok.display.excerpt.length <= 40 && ok.display.excerpt.endsWith('…'));
  const none = applyRights(item, { ...SRC, rights: { ...SRC.rights, headline: { status: 'pending' }, excerpt: { status: 'pending' }, group: { status: 'pending' }, analyse: { status: 'pending' } } });
  assert.deepEqual([none.display.headline, none.display.excerpt, none.groupText, none.analyseText], [null, null, null, null]);
  assert.equal(truncateExcerpt('short', 40), 'short');
});

test('I6 grouping joins near-identical titles in the window and nothing else', () => {
  assert.equal(hamming(simhash('Storm floods hundreds of homes in Cumbria'), simhash('STORM FLOODS HUNDREDS OF HOMES IN CUMBRIA!')), 0);
  const g = new Grouper();
  const mk = (id, title, h, owner) => ({ id, url: `https://e.org/${id}`, groupText: title, publishedAt: new Date(NOW + h * 3600e3).toISOString(), ownerGroup: owner });
  const a = g.add(mk(1, 'Storm floods hundreds of homes in Cumbria', 0, 'x'));
  assert.equal(g.add(mk(2, 'Storm floods hundreds of homes in Cumbria', 2, 'y')), a);
  assert.notEqual(g.add(mk(3, 'Telescope finds water vapour on distant planet', 2, 'y')), a);
  assert.notEqual(g.add(mk(4, 'Storm floods hundreds of homes in Cumbria', 60, 'z')), a, 'outside the 48-hour window');
  const noRight = g.add({ ...mk(5, null, 1, 'w'), url: 'https://e.org/1' });
  assert.equal(noRight, a, 'without the group right an item joins only by exact URL');
});

test('I7 collection: 304s, failures, duplicates and pruning, with no state kept between runs', async () => {
  const reg = { sources: [SRC, { ...SRC, id: 't', rights: { ...SRC.rights, fetch: { status: 'pending' } } }] };
  const seen = [];
  const fetchSource = async s => { seen.push(s.id); return { status: 200, body: Buffer.from(RSS), etag: '"1"' }; };
  const first = await collect({ register: reg, state: emptyState(), fetchSource, now: NOW });
  assert.deepEqual(seen, ['s'], 'sources without the fetch right are never fetched');
  assert.equal(first.stats.newItems, 1);
  const stored = structuredClone(Object.values(first.state.items)[0]);
  assert.ok(!('summary' in stored), 'the full summary is never stored');
  assert.ok(stored.excerpt.length <= 40, 'only the licensed excerpt length is stored');
  const again = await collect({ register: reg, state: first.state, fetchSource, now: NOW });
  assert.deepEqual([again.stats.newItems, again.stats.duplicates], [0, 1]);
  const nm = await collect({ register: reg, state: again.state, fetchSource: async () => ({ status: 304 }), now: NOW });
  assert.equal(nm.stats.notModified, 1);
  let st = nm.state;
  for (let i = 0; i < 3; i++) st = (await collect({ register: reg, state: st, fetchSource: async () => ({ status: 'error', code: 'timeout' }), now: NOW })).state;
  assert.equal(st.sources.s.health, 'failing');
  const later = await collect({ register: reg, state: st, fetchSource: async () => ({ status: 304 }), now: NOW + 31 * 86400e3 });
  assert.equal(later.stats.itemsTotal, 0, 'items older than 30 days are pruned');
});

test('I8 canary headlines without display rights never reach any rendered page', async () => {
  const T = Date.parse('2026-11-28T12:00:00Z');
  const tl = makeTimeline({ start: T - 2 * 86400e3, end: T, perDay: 2000 });
  const res = recordedResponses(tl, T, { unchangedShare: 0 });
  const { state } = await collect({ register: tl.register, state: emptyState(), fetchSource: async s => res.get(s.id), now: T });
  assert.ok(Object.values(state.items).some(i => i.sourceId.endsWith('9')), 'canary sources were collected');
  const dir = mkdtempSync(join(tmpdir(), 'render-'));
  renderLive(state, tl.register, dir, T);
  const all = d => readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? all(join(d, e.name)) : [join(d, e.name)]);
  for (const f of all(dir)) assert.ok(!readFileSync(f, 'utf8').includes(CANARY), f);
  assert.ok(Object.values(state.items).every(i => !i.title || !i.title.includes(CANARY) || tl.register.sources.find(s => s.id === i.sourceId).rights.group.status === 'confirmed'), 'canary titles are kept only where grouping is allowed');
});

test('I9 rendering escapes everything taken from feeds', () => {
  assert.equal(esc('<img src=x onerror=alert(1)>"\''), '&lt;img src=x onerror=alert(1)&gt;&quot;&#39;');
  assert.ok(rssFor({ name: 'A&B', homepage: 'https://e.org/' }, []).includes('A&amp;B'));
});

test('I10 items older than retention are skipped, so they cannot re-enter on every run', async () => {
  const old = RSS.replace('Fri, 27 Nov 2026 09:00:00 GMT', 'Mon, 01 Jan 2024 09:00:00 GMT');
  const reg = { sources: [SRC] };
  const fetchSource = async () => ({ status: 200, body: Buffer.from(old) });
  const a = await collect({ register: reg, state: emptyState(), fetchSource, now: NOW });
  const b = await collect({ register: reg, state: a.state, fetchSource, now: NOW });
  assert.deepEqual([a.stats.stale, a.stats.newItems, b.stats.stale, b.stats.newItems], [1, 0, 1, 0]);
});
