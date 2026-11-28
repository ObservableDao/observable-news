// One collection run: fetch (or replay) every source whose Fetch right is
// confirmed, parse, validate, apply rights, deduplicate, group, prune, snapshot.
import { parseFeed } from './feed.mjs';
import { normaliseItem } from './normalise.mjs';
import { applyRights } from './rights.mjs';
import { Grouper, WINDOW_MS } from './group.mjs';

export const RETENTION_DAYS = 30;
// The stored record keeps only what later steps need. Text is kept only where a
// right allows it: the title for display or grouping, the excerpt already cut to
// its licensed length. Source type, sections and owner come from the register.
export function compact(item, groupId, hash) {
  const rec = { id: item.id, sourceId: item.sourceId, url: item.url, publishedAt: item.publishedAt, groupId, ownerGroup: item.ownerGroup };
  if (item.display.headline || item.groupText) rec.title = item.title;
  if (item.display.excerpt) rec.excerpt = item.display.excerpt;
  if (hash !== null && hash !== undefined) rec.sh = hash.toString(16);
  return rec;
}

export const emptyState = () => ({ version: 1, items: {}, groups: {}, sources: {}, quarantine: {} });

async function pool(list, n, fn) {
  const out = new Array(list.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) { const k = i++; out[k] = await fn(list[k]); } }));
  return out;
}

// fetchSource(source, { etag, lastModified }) → { status: 200|304|error code, body?, etag?, lastModified? }
export async function collect({ register, state, fetchSource, now = Date.now(), concurrency = 8, retentionDays = RETENTION_DAYS }) {
  const stats = { feeds: 0, ok: 0, notModified: 0, failed: 0, parsed: 0, newItems: 0, duplicates: 0, quarantined: 0, groupsCreated: 0, joinedExisting: 0, comparisons: 0 };
  const sources = register.sources.filter(s => s.rights.fetch.status === 'confirmed');

  // Rebuild the grouping index from items still inside the window.
  const grouper = new Grouper();
  const recent = Object.values(state.items).filter(it => now - Date.parse(it.publishedAt) <= WINDOW_MS).sort((a, b) => a.publishedAt < b.publishedAt ? -1 : 1);
  for (const it of recent) grouper.seed(it, it.groupId);
  const before = grouper.groups.size;

  const added = new Map(); // groupId -> items added this run
  const results = await pool(sources, concurrency, async s => {
    const meta = state.sources[s.id] || {};
    try { return { s, r: await fetchSource(s, { etag: meta.etag, lastModified: meta.lastModified }) }; } catch (e) { return { s, r: { status: 'error', code: e.code || e.message } }; }
  });

  for (const { s, r } of results) {
    stats.feeds++;
    const meta = state.sources[s.id] || { failStreak: 0 };
    if (r.status === 304) { stats.notModified++; meta.failStreak = 0; meta.health = 'ok'; state.sources[s.id] = meta; continue; }
    if (r.status !== 200) { stats.failed++; meta.failStreak = (meta.failStreak || 0) + 1; meta.health = meta.failStreak >= 3 ? 'failing' : 'degraded'; meta.lastError = String(r.code || r.status); state.sources[s.id] = meta; continue; }
    let feed;
    try { feed = parseFeed(r.body); } catch (e) { stats.failed++; state.quarantine['parse-error'] = (state.quarantine['parse-error'] || 0) + 1; meta.failStreak = (meta.failStreak || 0) + 1; state.sources[s.id] = meta; continue; }
    stats.ok++; meta.failStreak = 0; meta.health = 'ok'; meta.etag = r.etag; meta.lastModified = r.lastModified; state.sources[s.id] = meta;
    for (const raw of feed.items) {
      stats.parsed++;
      const n = normaliseItem(raw, s, now);
      if (n.quarantine) { stats.quarantined++; state.quarantine[n.quarantine] = (state.quarantine[n.quarantine] || 0) + 1; continue; }
      if (state.items[n.item.id]) { stats.duplicates++; continue; }
      const item = applyRights(n.item, s);
      const existingGroups = grouper.groups.size;
      const groupId = grouper.add(item);
      added.set(groupId, (added.get(groupId) || 0) + 1);
      if (grouper.groups.size > existingGroups) stats.groupsCreated++; else stats.joinedExisting++;
      state.items[item.id] = compact(item, groupId, grouper.lastHash); stats.newItems++;
    }
  }
  stats.comparisons = grouper.comparisons;

  // Update group summaries for touched groups; prune old items and empty groups.
  for (const [gid, n] of added) {
    const g = grouper.groups.get(gid), prev = state.groups[gid];
    state.groups[gid] = {
      id: gid,
      firstSeen: prev && prev.firstSeen < g.firstSeen ? prev.firstSeen : g.firstSeen,
      lastSeen: prev && prev.lastSeen > g.lastSeen ? prev.lastSeen : g.lastSeen,
      itemCount: (prev ? prev.itemCount : 0) + n,
      publishers: Math.max(prev ? prev.publishers : 0, g.owners.size),
    };
  }
  const cutoff = now - retentionDays * 86400_000;
  let pruned = 0;
  for (const [id, it] of Object.entries(state.items)) if (Date.parse(it.publishedAt) < cutoff) { delete state.items[id]; pruned++; }
  for (const [id, g] of Object.entries(state.groups)) if (Date.parse(g.lastSeen) < cutoff) delete state.groups[id];
  stats.pruned = pruned;
  stats.groupsTotal = Object.keys(state.groups).length;
  stats.itemsTotal = Object.keys(state.items).length;
  stats.newGroupsThisRun = grouper.groups.size - before;
  return { state, stats };
}
