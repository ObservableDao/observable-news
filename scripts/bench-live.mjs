// M0 live benchmark and terms archive (runs on GitHub-hosted runners).
// Usage: node scripts/bench-live.mjs [--out live-out] [--register config/sources.json]
// Only sources whose Fetch right is confirmed are contacted. Polite: one
// identified user agent, robots.txt honoured, conditional requests, a few
// requests per source, sequential per host.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { parseFeed, discoverFeeds } from '../src/ingest/feed.mjs';
import { normaliseItem } from '../src/ingest/normalise.mjs';
import { collect, emptyState } from '../src/ingest/collect.mjs';
import { MAX_FEED_BYTES } from '../src/ingest/xml.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const OUT = arg('out', 'live-out');
const register = JSON.parse(readFileSync(arg('register', 'config/sources.json'), 'utf8'));
export const UA = 'ObservableNewsM0/0.1 (+https://github.com/ObservableDao/observable-news; benchmark)';
const TIMEOUT_MS = 20_000;

export async function get(url, headers = {}) {
  const t0 = performance.now();
  const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8', ...headers }, redirect: 'follow', signal: ctl.signal });
    const chunks = []; let size = 0;
    if (res.body) for await (const c of res.body) { size += c.length; if (size > MAX_FEED_BYTES) { ctl.abort(); throw Object.assign(new Error('too-large'), { code: 'too-large' }); } chunks.push(c); }
    return { status: res.status, finalUrl: res.url, ms: Math.round(performance.now() - t0), body: Buffer.concat(chunks), etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified'), contentType: res.headers.get('content-type') };
  } catch (e) { return { status: 'error', code: e.code || e.name || 'error', ms: Math.round(performance.now() - t0) }; }
  finally { clearTimeout(timer); }
}

// Minimal robots.txt check: the most specific matching rule wins; Allow wins ties.
export function robotsAllows(txt, agentToken, path) {
  const groups = []; let cur = null, lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); if (!line) continue;
    const [k, ...rest] = line.split(':'); const key = k.trim().toLowerCase(), val = rest.join(':').trim();
    if (key === 'user-agent') { if (!lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(val.toLowerCase()); lastWasAgent = true; continue; }
    lastWasAgent = false;
    if (cur && (key === 'allow' || key === 'disallow')) cur.rules.push({ allow: key === 'allow', path: val });
  }
  const token = agentToken.toLowerCase();
  const chosen = groups.filter(g => g.agents.some(a => a !== '*' && token.includes(a)));
  const rules = (chosen.length ? chosen : groups.filter(g => g.agents.includes('*'))).flatMap(g => g.rules).filter(r => r.path !== '');
  let best = null;
  for (const r of rules) {
    const re = new RegExp('^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (re.test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}

async function probeSource(s) {
  const out = { id: s.id, name: s.name };
  // Terms archive (evidence for the strict gate).
  if (s.termsUrl) {
    const t = await get(s.termsUrl);
    out.terms = { url: s.termsUrl, status: t.status, bytes: t.body?.length || 0, retrievedAt: new Date().toISOString() };
    if (t.status === 200) { out.terms.sha256 = createHash('sha256').update(t.body).digest('hex'); mkdirSync(join(OUT, 'evidence'), { recursive: true }); writeFileSync(join(OUT, 'evidence', `${s.id}.html`), t.body); }
  }
  // Feed: registered URL first, otherwise discovery from the homepage.
  let feedUrl = s.feeds.find(f => f.url)?.url || null, discovered = false;
  let first = feedUrl ? await get(feedUrl) : null;
  if (!first || first.status !== 200) {
    const from = s.feeds.find(f => f.discoverFrom)?.discoverFrom || s.homepage;
    const page = await get(from, { Accept: 'text/html' });
    const cands = page.status === 200 ? discoverFeeds(page.body.toString('utf8'), page.finalUrl || from) : [];
    if (cands.length) { feedUrl = cands[0]; discovered = true; first = await get(feedUrl); }
  }
  if (!feedUrl || !first) return { ...out, feed: { status: 'no-feed-found' } };
  const u = new URL(feedUrl);
  const robots = await get(`${u.origin}/robots.txt`, { Accept: 'text/plain' });
  const allowed = robots.status === 200 ? robotsAllows(robots.body.toString('utf8'), 'ObservableNewsM0', u.pathname + u.search) : true;
  out.feed = { url: feedUrl, discovered, status: first.status, ms: first.ms, bytes: first.body?.length || 0, etag: !!first.etag, lastModified: !!first.lastModified, robots: robots.status === 200 ? (allowed ? 'allowed' : 'disallowed') : `no robots.txt (${robots.status})` };
  if (!allowed) { out.feed.note = 'robots.txt disallows this path: the Fetch right must not be confirmed'; return out; }
  if (first.status !== 200) return out;
  try {
    const items = parseFeed(first.body).items;
    const now = Date.now();
    const dated = items.filter(i => i.published).map(i => Date.parse(i.published)).sort((a, b) => a - b);
    const week = dated.filter(t => now - t <= 7 * 86400e3).length;
    const spanDays = dated.length > 1 ? (dated.at(-1) - dated[0]) / 86400e3 : null;
    const q = {}; let valid = 0;
    for (const it of items) { const n = normaliseItem(it, s, now); if (n.quarantine) q[n.quarantine] = (q[n.quarantine] || 0) + 1; else valid++; }
    Object.assign(out.feed, { items: items.length, valid, quarantine: q, newest: dated.length ? new Date(dated.at(-1)).toISOString() : null,
      itemsPerDay: +(week >= 3 || !spanDays ? week / 7 : Math.min(items.length / Math.max(spanDays, 1 / 24), 999)).toFixed(1) });
  } catch (e) { out.feed.parseError = e.code || e.message; }
  // Conditional request: does the server answer 304?
  const cond = await get(feedUrl, { ...(first.etag ? { 'If-None-Match': first.etag } : {}), ...(first.lastModified ? { 'If-Modified-Since': first.lastModified } : {}) });
  out.feed.conditional = first.etag || first.lastModified ? cond.status : 'no validators';
  return out;
}

const sources = register.sources.filter(s => s.rights.fetch.status === 'confirmed');
const probes = [];
for (const s of sources) probes.push(await probeSource(s)); // sequential: gentle on publishers

// A real collection run over the network (feeds found above), twice: full, then conditional.
const reg2 = { ...register, sources: sources.map(s => { const p = probes.find(x => x.id === s.id); return p?.feed?.url && p.feed.robots !== 'disallowed' ? { ...s, feeds: [{ url: p.feed.url, verified: true }] } : { ...s, rights: { ...s.rights, fetch: { ...s.rights.fetch, status: 'pending' } } }; }) };
const fetchSource = async (s, meta) => { const r = await get(s.feeds[0].url, { ...(meta.etag ? { 'If-None-Match': meta.etag } : {}), ...(meta.lastModified ? { 'If-Modified-Since': meta.lastModified } : {}) }); return r.status === 200 ? { status: 200, body: r.body, etag: r.etag, lastModified: r.lastModified } : { status: r.status === 304 ? 304 : 'error', code: r.code || r.status }; };
const runs = [];
let state = emptyState();
for (let i = 0; i < 2; i++) { const t0 = performance.now(); const r = await collect({ register: reg2, state, fetchSource, concurrency: 4 }); state = r.state; runs.push({ ms: Math.round(performance.now() - t0), ...r.stats }); }

const results = { generatedAt: new Date().toISOString(), userAgent: UA, runner: process.env.RUNNER_NAME || null, probes, collectionRuns: runs };
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'live.json'), JSON.stringify(results, null, 2));
const md = ['### M0 live run (registered sources with a confirmed Fetch right)', '',
  '| Source | Feed | HTTP | ms | KB | Items | Items/day | 304 | robots | Terms archived |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...probes.map(p => `| ${p.name} | ${p.feed?.url ? (p.feed.discovered ? 'discovered' : 'registered') : (p.feed?.status || 'none')} | ${p.feed?.status ?? ''} | ${p.feed?.ms ?? ''} | ${p.feed?.bytes ? (p.feed.bytes / 1024).toFixed(0) : ''} | ${p.feed?.items ?? ''} | ${p.feed?.itemsPerDay ?? ''} | ${p.feed?.conditional ?? ''} | ${p.feed?.robots ?? ''} | ${p.terms?.sha256 ? `yes (${p.terms.sha256.slice(0, 12)}…)` : `no (${p.terms?.status ?? 'no URL'})`} |`),
  '', `Collection over the network: run 1 ${runs[0].ms} ms (${runs[0].ok} feeds, ${runs[0].newItems} items), run 2 ${runs[1].ms} ms (${runs[1].notModified} unchanged, ${runs[1].newItems} new).`,
  `Estimated independent-news volume: ${probes.filter(p => sources.find(s => s.id === p.id).sourceType === 'independent-news').reduce((a, p) => a + (p.feed?.itemsPerDay || 0), 0).toFixed(1)} items/day.`].join('\n');
writeFileSync(join(OUT, 'live.md'), md + '\n');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
console.log(md);
