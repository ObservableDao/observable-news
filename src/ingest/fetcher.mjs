// Polite HTTP fetching for publisher sites.
// * robots.txt is checked BEFORE every request, including every redirect hop,
//   and per origin (a redirect to another host checks that host's robots.txt).
// * robots.txt handling follows RFC 9309: a 2xx file is parsed; a 4xx means no
//   restrictions; a 5xx, a network failure or a timeout means everything is
//   disallowed. robots.txt itself may redirect (up to 5 hops).
// * Redirects are followed manually (at most 5), http(s) only.
// * One identified user agent; response size and time limits.
import { MAX_FEED_BYTES } from './xml.mjs';

export const USER_AGENT = 'ObservableNewsM0/0.1 (+https://github.com/ObservableDao/observable-news)';
export const AGENT_TOKEN = 'ObservableNewsM0';
const MAX_REDIRECTS = 5;

// The most specific matching rule wins; Allow wins ties. Group chosen by product token, else "*".
export function robotsAllows(txt, agentToken, path) {
  const groups = []; let cur = null, lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); if (!line) continue;
    const i = line.indexOf(':'); if (i < 0) continue;
    const key = line.slice(0, i).trim().toLowerCase(), val = line.slice(i + 1).trim();
    if (key === 'user-agent') { if (!lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(val.toLowerCase()); lastWasAgent = true; continue; }
    lastWasAgent = false;
    if (cur && (key === 'allow' || key === 'disallow')) cur.rules.push({ allow: key === 'allow', path: val });
  }
  const token = agentToken.toLowerCase();
  const named = groups.filter(g => g.agents.some(a => a !== '*' && token.includes(a)));
  const rules = (named.length ? named : groups.filter(g => g.agents.includes('*'))).flatMap(g => g.rules).filter(r => r.path !== '');
  let best = null;
  for (const r of rules) {
    const re = new RegExp('^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (re.test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}

export function createFetcher({ fetchImpl = globalThis.fetch, userAgent = USER_AGENT, agentToken = AGENT_TOKEN, timeoutMs = 20_000, maxBytes = MAX_FEED_BYTES } = {}) {
  const robots = new Map(); // origin -> Promise<{ kind: 'rules'|'allow-all'|'disallow-all', txt?, reason }>
  const log = [];           // every request made, for tests and reports

  async function raw(url, headers = {}) {
    log.push(url);
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
    const t0 = performance.now();
    try {
      const res = await fetchImpl(url, { headers: { 'User-Agent': userAgent, ...headers }, redirect: 'manual', signal: ctl.signal });
      const chunks = []; let size = 0;
      if (res.body) for await (const c of res.body) { size += c.length; if (size > maxBytes) { ctl.abort(); return { status: 'error', code: 'too-large', ms: Math.round(performance.now() - t0) }; } chunks.push(Buffer.from(c)); }
      return { status: res.status, location: res.headers.get('location'), etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified'), contentType: res.headers.get('content-type'), body: Buffer.concat(chunks), ms: Math.round(performance.now() - t0) };
    } catch (e) { return { status: 'error', code: e.name === 'AbortError' ? 'timeout' : (e.code || e.name || 'network'), ms: Math.round(performance.now() - t0) }; }
    finally { clearTimeout(timer); }
  }

  function robotsFor(origin) {
    if (!robots.has(origin)) robots.set(origin, (async () => {
      let url = `${origin}/robots.txt`;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        const r = await raw(url, { Accept: 'text/plain' });
        if (typeof r.status === 'number' && r.status >= 300 && r.status < 400 && r.location) { url = new URL(r.location, url).toString(); continue; }
        if (typeof r.status === 'number' && r.status >= 200 && r.status < 300) return { kind: 'rules', txt: r.body.toString('utf8'), reason: 'robots.txt' };
        if (typeof r.status === 'number' && r.status >= 400 && r.status < 500) return { kind: 'allow-all', reason: `robots.txt ${r.status}` };
        return { kind: 'disallow-all', reason: `robots.txt unreachable (${r.status === 'error' ? r.code : r.status})` };
      }
      return { kind: 'disallow-all', reason: 'robots.txt redirect loop' };
    })());
    return robots.get(origin);
  }

  async function allowed(url) {
    const u = new URL(url);
    const r = await robotsFor(u.origin);
    if (r.kind === 'allow-all') return { ok: true, reason: r.reason };
    if (r.kind === 'disallow-all') return { ok: false, reason: r.reason };
    const ok = robotsAllows(r.txt, agentToken, u.pathname + u.search);
    return { ok, reason: ok ? 'allowed by robots.txt' : 'disallowed by robots.txt' };
  }

  async function get(url, headers = {}) {
    let current = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      let u; try { u = new URL(current); } catch { return { status: 'error', code: 'bad-url', url: current }; }
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return { status: 'error', code: 'bad-scheme', url: current };
      const a = await allowed(current);
      if (!a.ok) return { status: 'blocked', code: a.reason, url: current, redirects: hop };
      const r = await raw(current, headers);
      if (typeof r.status === 'number' && r.status >= 300 && r.status < 400 && r.status !== 304 && r.location) { current = new URL(r.location, current).toString(); continue; }
      return { ...r, finalUrl: current, redirects: hop, robots: a.reason };
    }
    return { status: 'error', code: 'too-many-redirects', url: current };
  }

  return { get, allowed, robotsFor, log };
}

// Adapter to collect()'s fetchSource interface.
export function fetchSourceWith(fetcher) {
  return async (source, meta = {}) => {
    const url = source.feeds.find(f => f.url)?.url;
    if (!url) return { status: 'error', code: 'no-feed-url' };
    const r = await fetcher.get(url, { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml', ...(meta.etag ? { 'If-None-Match': meta.etag } : {}), ...(meta.lastModified ? { 'If-Modified-Since': meta.lastModified } : {}) });
    if (r.status === 200) return { status: 200, body: r.body, etag: r.etag, lastModified: r.lastModified };
    if (r.status === 304) return { status: 304 };
    if (r.status === 'blocked') return { status: 'blocked', code: r.code };
    return { status: 'error', code: r.code || r.status };
  };
}
