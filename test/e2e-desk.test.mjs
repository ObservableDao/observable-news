// End-to-end: the private export script signs; the public gate accepts it,
// and rejects the same export after substitution. Skipped if the desk repo is absent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';
import { acceptBundle } from '../src/bundle/accept.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const desk = join(repo, '..', 'observable-news-desk');

test('desk export is accepted by the public gate; substituted export is rejected', { skip: !existsSync(desk) && 'desk repo not present' }, () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519'); // ephemeral, test only
  const out = mkdtempSync(join(tmpdir(), 'export-'));
  const r = spawnSync(process.execPath, [join(desk, 'scripts/export.mjs'), join(desk, 'content/sample-approved.json'), out, '7', 'b'.repeat(40)], {
    encoding: 'utf8',
    env: { ...process.env, DESK_SIGNING_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }), DESK_KEY_ID: 'desk-test', PUBLIC_REPO_DIR: repo },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stdout.includes('SAMPLE CONTENT'), 'export log must not contain content');
  const trustStore = [{ keyId: 'desk-test', publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }) }];
  const load = () => ({ bundleBytes: readFileSync(join(out, 'bundle.json')), manifest: JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8')), signature: readFileSync(join(out, 'signature.txt'), 'utf8').trim(), trustStore, lastAcceptedSequence: 0 });
  assert.equal(acceptBundle(load()).ok, true);
  writeFileSync(join(out, 'bundle.json'), readFileSync(join(out, 'bundle.json'), 'utf8').replace('SAMPLE CONTENT', 'SUBSTITUTED'));
  const rejected = acceptBundle(load());
  assert.equal(rejected.ok, false);
  assert.ok(['hash-mismatch', 'size-mismatch'].includes(rejected.reason), rejected.reason);
});
