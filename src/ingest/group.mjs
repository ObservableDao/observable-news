// Similarity grouping: 64-bit SimHash over title word shingles, with LSH
// banding so each item is compared only with plausible candidates.
// Four 16-bit bands guarantee every pair within Hamming distance 3 shares a band.
const STOP = new Set('the a an and or of to in on for with at by from as is are was were be been it its this that after over into new says say said how why what who will can could may might than then there their they them about up out more most not no yes'.split(' '));
const FNV_OFFSET = 0xcbf29ce484222325n, FNV_PRIME = 0x100000001b3n, MASK = (1n << 64n) - 1n;
export const MAX_DISTANCE = 3;
export const WINDOW_MS = 48 * 3600 * 1000;

function fnv1a64(s) {
  let h = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) { h ^= BigInt(s.charCodeAt(i)); h = (h * FNV_PRIME) & MASK; }
  return h;
}

export function tokens(text) {
  return text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w));
}

export function simhash(text) {
  const t = tokens(text);
  const feats = t.length > 1 ? t.slice(0, -1).map((w, i) => w + ' ' + t[i + 1]).concat(t) : t;
  if (!feats.length) return null;
  const v = new Int32Array(64);
  for (const f of feats) { const h = fnv1a64(f); for (let b = 0; b < 64; b++) v[b] += (h >> BigInt(b)) & 1n ? 1 : -1; }
  let out = 0n;
  for (let b = 0; b < 64; b++) if (v[b] > 0) out |= 1n << BigInt(b);
  return out;
}

export function hamming(a, b) { let x = a ^ b, n = 0; while (x) { x &= x - 1n; n++; } return n; }
const bands = h => [0n, 16n, 32n, 48n].map((s, i) => `${i}:${(h >> s) & 0xffffn}`);

export class Grouper {
  constructor({ nextId = 1 } = {}) { this.byUrl = new Map(); this.buckets = new Map(); this.groups = new Map(); this.next = nextId; this.comparisons = 0; }
  #newGroup(item) {
    const id = `g${this.next++}`;
    this.groups.set(id, { id, firstSeen: item.publishedAt, lastSeen: item.publishedAt, items: [], owners: new Set() });
    return id;
  }
  // Re-insert an item already in state with its existing group (rebuilds the index).
  seed(item, gid) {
    const n = Number(gid.slice(1)); if (n >= this.next) this.next = n + 1;
    if (!this.groups.has(gid)) this.groups.set(gid, { id: gid, firstSeen: item.publishedAt, lastSeen: item.publishedAt, items: [], owners: new Set() });
    const g = this.groups.get(gid); g.items.push(item.id); g.owners.add(item.ownerGroup);
    if (item.publishedAt > g.lastSeen) g.lastSeen = item.publishedAt;
    this.byUrl.set(item.url, gid);
    const h = item.sh ? BigInt('0x' + item.sh) : null;
    if (h !== null) { const entry = { h, gid, t: Date.parse(item.publishedAt) }; for (const key of bands(h)) { const b = this.buckets.get(key) || []; b.push(entry); this.buckets.set(key, b); } }
  }
  add(item) {
    let gid = this.byUrl.get(item.url);
    const h = item.groupText ? simhash(item.groupText) : null;
    const t = Date.parse(item.publishedAt);
    if (!gid && h !== null) {
      const seen = new Set();
      for (const key of bands(h)) for (const cand of this.buckets.get(key) || []) {
        if (seen.has(cand)) continue; seen.add(cand); this.comparisons++;
        if (Math.abs(t - cand.t) <= WINDOW_MS && hamming(h, cand.h) <= MAX_DISTANCE) { gid = cand.gid; break; }
      }
    }
    if (!gid) gid = this.#newGroup(item);
    const g = this.groups.get(gid);
    g.items.push(item.id); g.owners.add(item.ownerGroup);
    if (item.publishedAt > g.lastSeen) g.lastSeen = item.publishedAt;
    if (item.publishedAt < g.firstSeen) g.firstSeen = item.publishedAt;
    this.byUrl.set(item.url, gid);
    if (h !== null) { const entry = { h, gid, t }; for (const key of bands(h)) { const b = this.buckets.get(key) || []; b.push(entry); this.buckets.set(key, b); } }
    this.lastHash = h;
    return gid;
  }
}
