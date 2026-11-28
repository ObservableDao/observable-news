// Minimal, defensive XML reader for RSS and Atom feeds (zero dependencies).
// Security rules from the architecture: no DTDs, no external or custom
// entities, size, depth and node limits. Never evaluates or fetches anything.
export const MAX_FEED_BYTES = 5 * 1024 * 1024;
const MAX_DEPTH = 64, MAX_NODES = 200_000;
const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export class FeedError extends Error { constructor(code) { super(code); this.code = code; } }

export function decodeXmlEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isInteger(cp) && cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : '';
    }
    return XML_ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function parseXml(input) {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input);
  if (Buffer.byteLength(text) > MAX_FEED_BYTES) throw new FeedError('feed-too-large');
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new FeedError('dtd-not-allowed');
  const root = { name: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0, nodes = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) { stack.at(-1).text += decodeXmlEntities(text.slice(i)); break; }
    if (lt > i) stack.at(-1).text += decodeXmlEntities(text.slice(i, lt));
    if (text.startsWith('<!--', lt)) { const e = text.indexOf('-->', lt + 4); if (e < 0) throw new FeedError('unterminated-comment'); i = e + 3; continue; }
    if (text.startsWith('<![CDATA[', lt)) { const e = text.indexOf(']]>', lt + 9); if (e < 0) throw new FeedError('unterminated-cdata'); stack.at(-1).text += text.slice(lt + 9, e); i = e + 3; continue; }
    if (text.startsWith('<?', lt)) { const e = text.indexOf('?>', lt + 2); if (e < 0) throw new FeedError('unterminated-pi'); i = e + 2; continue; }
    if (text.startsWith('<!', lt)) throw new FeedError('declaration-not-allowed');
    const gt = text.indexOf('>', lt);
    if (gt < 0) throw new FeedError('unterminated-tag');
    const raw = text.slice(lt + 1, gt);
    i = gt + 1;
    if (raw[0] === '/') {
      const name = raw.slice(1).trim();
      const at = stack.map(n => n.name).lastIndexOf(name);
      if (at > 0) stack.length = at; // tolerate unclosed children
      continue;
    }
    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const m = /^([^\s/>]+)/.exec(body);
    if (!m) throw new FeedError('bad-tag');
    const attrs = {};
    for (const a of body.slice(m[1].length).matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[a[1]] = decodeXmlEntities(a[2] ?? a[3] ?? '');
    const node = { name: m[1], attrs, children: [], text: '' };
    if (++nodes > MAX_NODES) throw new FeedError('too-many-nodes');
    stack.at(-1).children.push(node);
    if (!selfClosing) { stack.push(node); if (stack.length > MAX_DEPTH) throw new FeedError('too-deep'); }
  }
  const top = root.children.find(n => n.name !== '#text');
  if (!top) throw new FeedError('empty-document');
  return top;
}

export const local = name => name.includes(':') ? name.slice(name.indexOf(':') + 1) : name;
export const child = (n, name) => n.children.find(c => local(c.name) === name);
export const childrenNamed = (n, name) => n.children.filter(c => local(c.name) === name);
export const textOf = n => (n ? n.text : '').trim();
