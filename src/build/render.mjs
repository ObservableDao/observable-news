// Static page renderer used by the M0 benchmarks. It stands in for the
// Astro build that M1 introduces: the same page counts and similar page
// weight, so file counts, bytes and relative timings are meaningful. The M1
// build must be re-benchmarked with the real templates.
//
// Rights are enforced here: an item without a display headline is never rendered.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SECTIONS = { uk: 'UK', world: 'World', 'science-space': 'Science & Space', 'technology-ai': 'Technology & AI', business: 'Business' };

// Page chrome comparable to the R4 layout (rail, grouped menu, footer, inline critical CSS).
const NAV = Object.entries(SECTIONS).map(([k, v]) => `<li><a href="/topics/${k}/">${esc(v)}</a></li>`).join('');
const CSS = ':root{--ink:#14171f;--paper:#fbfaf7;--accent:#1f5eff}' + 'body{margin:0;font:16px/1.55 system-ui;color:var(--ink);background:var(--paper)}'.repeat(12);
const chrome = (title, body) => `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} | Observable</title><style>${CSS}</style></head><body><a class="skip" href="#main">Skip to content</a><header class="top"><a href="/" class="brand">Observable</a><p class="tag">The world, in perspective</p></header><nav class="rail" aria-label="Sections"><ul><li><a href="/latest/">Latest</a></li><li><a href="/briefing/">Daily Briefing</a></li>${NAV}</ul></nav><main id="main" data-pagefind-body>${body}</main><footer><p>Headlines and excerpts are the publishers' own. Observable is built with AI-assisted development; it does not write news.</p><nav><a href="/methodology/">Methodology</a> <a href="/corrections/">Corrections</a> <a href="/privacy/">Privacy</a> <a href="/credits/">Image credits</a></nav></footer></body></html>`;

// Defence in depth: rights are checked again here from the register, so a
// stored title is never shown unless the source's headline right is confirmed.
function itemCard(it, source) {
  if (!source || source.rights.headline.status !== 'confirmed' || !it.title) return '';
  const ex = it.excerpt && source.rights.excerpt.status === 'confirmed' ? `<p class="ex">${esc(it.excerpt)}</p>` : '';
  return `<article class="item"><h3><a href="${esc(it.url)}" rel="noopener">${esc(it.title)}</a></h3>${ex}<p class="meta"><span class="src">${esc(source.name)}</span> · <span class="type">${esc(source.sourceType)}</span> · <time datetime="${esc(it.publishedAt)}">${esc(it.publishedAt.slice(0, 16).replace('T', ' '))}</time></p></article>`;
}

function write(dir, rel, html, acc) {
  const p = join(dir, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, html);
  acc.files++; acc.bytes += Buffer.byteLength(html);
}

// Live layer: home, Latest, today's briefing, topic indexes, status, and
// story groups active in the last 7 days.
export const MIN_GROUP_PUBLISHERS = 2;  // a page for each group with two or more independent publishers

export function renderLive(state, register, outDir, now = Date.now()) {
  const acc = { files: 0, bytes: 0 };
  const src = new Map(register.sources.map(s => [s.id, s]));
  const shown = it => { const s = src.get(it.sourceId); return s && s.rights.headline.status === 'confirmed' && it.title; };
  const items = Object.values(state.items).filter(shown).sort((a, b) => a.publishedAt < b.publishedAt ? 1 : -1);
  const card = it => itemCard(it, src.get(it.sourceId));
  const byGroup = new Map();
  for (const it of items) { const l = byGroup.get(it.groupId) || []; l.push(it); byGroup.set(it.groupId, l); }
  const active = Object.values(state.groups).filter(g => now - Date.parse(g.lastSeen) <= 7 * 86400_000 && byGroup.has(g.id));
  const ranked = [...active].sort((a, b) => (b.publishers - a.publishers) || (a.lastSeen < b.lastSeen ? 1 : -1));
  const lead = g => byGroup.get(g.id)[0];
  const inSection = (it, sec) => (src.get(it.sourceId).sections || []).includes(sec);
  write(outDir, 'index.html', chrome('Home', `<h1>Today</h1>${ranked.slice(0, 40).map(g => card(lead(g))).join('')}`), acc);
  write(outDir, 'latest/index.html', chrome('Latest', `<h1>Latest</h1>${items.slice(0, 200).map(card).join('')}`), acc);
  const briefing = Object.keys(SECTIONS).map(sec => `<section><h2>${esc(SECTIONS[sec])}</h2>${ranked.filter(g => inSection(lead(g), sec)).slice(0, 6).map(g => card(lead(g))).join('')}</section>`).join('');
  write(outDir, 'briefing/index.html', chrome('Daily Briefing', `<h1>Daily Briefing</h1><p class="note">Selected automatically from permitted sources. Headlines and excerpts are the publishers' own. Not checked by an editor.</p>${briefing}`), acc);
  for (const sec of Object.keys(SECTIONS)) write(outDir, `topics/${sec}/index.html`, chrome(SECTIONS[sec], `<h1>${esc(SECTIONS[sec])}</h1>${items.filter(i => inSection(i, sec)).slice(0, 100).map(card).join('')}`), acc);
  write(outDir, 'status/index.html', chrome('Status', `<h1>Status</h1><table>${Object.entries(state.sources).map(([id, s]) => `<tr><td>${esc(src.get(id)?.name || id)}</td><td>${esc(s.health || 'unknown')}</td></tr>`).join('')}</table>`), acc);
  let groupPages = 0;
  for (const g of active) {
    if (g.publishers < MIN_GROUP_PUBLISHERS) continue;
    groupPages++;
    write(outDir, `groups/${g.id}/index.html`, chrome(lead(g).title, `<h1>${esc(lead(g).title)}</h1><p class="meta">${g.publishers} publishers · ${g.itemCount} items</p>${byGroup.get(g.id).map(card).join('')}`), acc);
  }
  acc.groupPages = groupPages; acc.activeGroups = active.length;
  return acc;
}

// Archive: 12 months of synthetic, clearly labelled pages (architecture test set-up).
export function renderArchive({ groups, explainers, editions }, outDir) {
  const acc = { files: 0, bytes: 0 };
  const label = '<p class="demo">SYNTHETIC BENCHMARK PAGE: not real news.</p>';
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    write(outDir, `archive/groups/${g.id}/index.html`, chrome(g.title, `${label}<h1>${esc(g.title)}</h1>${g.items.map(it => itemCard(it, it.source)).join('')}`), acc);
  }
  for (const e of explainers) write(outDir, `explainers/${e.id}/index.html`, chrome(e.title, `${label}<h1>${esc(e.title)}</h1>${e.paragraphs.map(p => `<p>${esc(p)}</p>`).join('')}`), acc);
  for (const ed of editions) write(outDir, `briefing/${ed.date}/index.html`, chrome(`Briefing ${ed.date}`, `${label}<h1>Daily Briefing, ${esc(ed.date)}</h1>${ed.items.map(it => itemCard(it, it.source)).join('')}`), acc);
  return acc;
}
