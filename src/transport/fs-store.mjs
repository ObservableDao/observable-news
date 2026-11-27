// Simulated GitHub release store, persisted to a directory so that separate
// processes (separate simulated workflow runs) share it the way separate
// GitHub-hosted runners share a repository's releases.
//
// It models the documented behaviour of immutable releases:
//   * a draft has no tag; publishing creates the tag;
//   * once published with immutability on, assets cannot be added, replaced or deleted;
//   * a published release can still be deleted, but its tag name can never be reused;
//   * disabling immutability does not unlock releases published while it was on.
// Test-only fault injection lives in the tests, not here.
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export class StoreError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

const SAFE_NAME = /^[A-Za-z0-9._-]{1,100}$/;

export class FsReleaseStore {
  constructor(dir, { immutableReleases } = {}) {
    this.dir = dir;
    mkdirSync(join(dir, 'assets'), { recursive: true });
    if (!existsSync(this.#statePath)) this.#save({ nextId: 1, settings: { immutableReleases: immutableReleases ?? true }, releases: [], usedTags: [], dispatches: [] });
    else if (immutableReleases !== undefined) { const s = this.#load(); s.settings.immutableReleases = immutableReleases; this.#save(s); }
  }
  get #statePath() { return join(this.dir, 'state.json'); }
  #load() { return JSON.parse(readFileSync(this.#statePath, 'utf8')); }
  #save(s) { const tmp = this.#statePath + '.tmp'; writeFileSync(tmp, JSON.stringify(s, null, 2)); renameSync(tmp, this.#statePath); }
  #find(s, id) { const r = s.releases.find(x => x.id === id); if (!r) throw new StoreError('not-found'); return r; }

  async list() {
    return this.#load().releases.map(r => ({ id: r.id, tag: r.tag, draft: r.draft, immutable: r.immutable, assets: r.assets.map(name => ({ name })) }));
  }
  async download(id, name) {
    const r = this.#find(this.#load(), id);
    if (!r.assets.includes(name)) throw new StoreError('asset-not-found');
    return readFileSync(join(this.dir, 'assets', String(id), name));
  }
  async createDraft(tag) {
    if (!/^[a-z0-9][a-z0-9.T:-]{0,99}$/.test(tag)) throw new StoreError('bad-tag');
    const s = this.#load(); const id = s.nextId++;
    s.releases.push({ id, tag, draft: true, immutable: false, assets: [] });
    this.#save(s); return id;
  }
  async upload(id, name, bytes) {
    if (!SAFE_NAME.test(name)) throw new StoreError('bad-asset-name');
    const s = this.#load(); const r = this.#find(s, id);
    if (r.immutable) throw new StoreError('asset-locked', 'release is immutable');
    if (r.assets.includes(name)) throw new StoreError('asset-exists');
    mkdirSync(join(this.dir, 'assets', String(id)), { recursive: true });
    writeFileSync(join(this.dir, 'assets', String(id), name), bytes);
    r.assets.push(name); this.#save(s);
  }
  async deleteAsset(id, name) {
    const s = this.#load(); const r = this.#find(s, id);
    if (r.immutable) throw new StoreError('asset-locked', 'release is immutable');
    r.assets = r.assets.filter(a => a !== name);
    rmSync(join(this.dir, 'assets', String(id), name), { force: true });
    this.#save(s);
  }
  async publish(id) {
    const s = this.#load(); const r = this.#find(s, id);
    if (!r.draft) throw new StoreError('not-draft');
    if (s.usedTags.includes(r.tag)) throw new StoreError('tag-already-used', 'tag_name was used by an immutable release');
    r.draft = false; r.immutable = !!s.settings.immutableReleases;
    s.usedTags.push(r.tag); this.#save(s);
  }
  async remove(id) {
    const s = this.#load(); this.#find(s, id);
    s.releases = s.releases.filter(x => x.id !== id);   // tag name stays in usedTags
    rmSync(join(this.dir, 'assets', String(id)), { recursive: true, force: true });
    this.#save(s);
  }
  async dispatch(eventType, payload = {}) {
    const s = this.#load(); s.dispatches.push({ eventType, payload }); this.#save(s);
  }
}
