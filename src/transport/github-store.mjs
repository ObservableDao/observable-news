// GitHub REST implementation of the release store (same interface as FsReleaseStore).
// NOT YET EXERCISED AGAINST GITHUB: this environment has no network access.
// Live tests T-L1 to T-L4 in docs/SECURITY-TESTS.md must pass before any
// workflow that uses it is enabled.
import { StoreError } from './fs-store.mjs';

const API = 'https://api.github.com';
const UPLOADS = 'https://uploads.github.com';

export class GitHubReleaseStore {
  constructor(repo, token) {
    if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo)) throw new Error('repo must be owner/name');
    if (!token) throw new Error('GH_TOKEN is required');
    this.repo = repo; this.token = token;
  }
  async #req(method, url, { body, accept = 'application/vnd.github+json', raw } = {}) {
    const headers = { Authorization: `Bearer ${this.token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' };
    if (body && !raw) headers['Content-Type'] = 'application/json';
    if (raw) headers['Content-Type'] = 'application/octet-stream';
    const res = await fetch(url, { method, headers, body: raw ? body : body ? JSON.stringify(body) : undefined, redirect: 'follow' });
    if (res.status === 204) return null;
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 422 && /used by an immutable release|already_exists/i.test(text)) throw new StoreError('tag-already-used');
      if (res.status === 422 && /immutable/i.test(text)) throw new StoreError('asset-locked');
      if (res.status === 404) throw new StoreError('not-found');
      throw new StoreError('http-' + res.status);
    }
    return accept === 'application/octet-stream' ? Buffer.from(await res.arrayBuffer()) : res.json();
  }
  async list() {
    const out = [];
    for (let page = 1; page <= 50; page++) {
      const batch = await this.#req('GET', `${API}/repos/${this.repo}/releases?per_page=100&page=${page}`);
      for (const r of batch) out.push({ id: r.id, tag: r.tag_name, draft: r.draft, immutable: r.immutable === true, assets: r.assets.map(a => ({ name: a.name, assetId: a.id })) });
      if (batch.length < 100) break;
    }
    return out;
  }
  async #assetId(id, name) {
    const r = await this.#req('GET', `${API}/repos/${this.repo}/releases/${id}`);
    const a = r.assets.find(x => x.name === name);
    if (!a) throw new StoreError('asset-not-found');
    return a.id;
  }
  async download(id, name) {
    const assetId = await this.#assetId(id, name);
    return this.#req('GET', `${API}/repos/${this.repo}/releases/assets/${assetId}`, { accept: 'application/octet-stream' });
  }
  async createDraft(tag) {
    const r = await this.#req('POST', `${API}/repos/${this.repo}/releases`, { body: { tag_name: tag, name: tag, draft: true, target_commitish: 'main', make_latest: 'false' } });
    return r.id;
  }
  async upload(id, name, bytes) {
    await this.#req('POST', `${UPLOADS}/repos/${this.repo}/releases/${id}/assets?name=${encodeURIComponent(name)}`, { body: bytes, raw: true });
  }
  async deleteAsset(id, name) {
    const assetId = await this.#assetId(id, name);
    await this.#req('DELETE', `${API}/repos/${this.repo}/releases/assets/${assetId}`);
  }
  async publish(id) {
    await this.#req('PATCH', `${API}/repos/${this.repo}/releases/${id}`, { body: { draft: false, make_latest: 'false' } });
  }
  async remove(id) { await this.#req('DELETE', `${API}/repos/${this.repo}/releases/${id}`); }
  async dispatch(eventType, payload = {}) {
    await this.#req('POST', `${API}/repos/${this.repo}/dispatches`, { body: { event_type: eventType, client_payload: payload } });
  }
}

export async function storeFromSpec(spec) {
  if (spec?.startsWith('fs:')) { const { FsReleaseStore } = await import('./fs-store.mjs'); return new FsReleaseStore(spec.slice(3)); }
  if (spec?.startsWith('github:')) return new GitHubReleaseStore(spec.slice(7), process.env.GH_TOKEN);
  throw new Error('store must be fs:<dir> or github:<owner>/<repo>');
}
