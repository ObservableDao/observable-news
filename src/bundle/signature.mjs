// Approved-bundle authenticity for Observable News.
//
// Trust model (see docs/TRUST-BOUNDARY.md):
//   * The private desk repository signs each export with an Ed25519 key held
//     only as a repository secret there (DESK_SIGNING_KEY).
//   * The public repository trusts only the public keys listed in
//     config/desk-signers.json, which sits under the public ruleset.
//   * Each manifest names the publication checkpoint it was built on
//     (basedOn) and the next sequence number. The public gate accepts it only
//     if both match the current, signed publication head (src/publish/),
//     which is stored durably in immutable GitHub releases.
//   * A valid signature proves the bundle was produced by a holder of the
//     signing key. It does NOT prove editorial quality; the strict content
//     schema runs independently afterwards.
//
// Zero dependencies: Node's built-in crypto (Ed25519) only.

import { createHash, sign, verify, createPublicKey } from 'node:crypto';

export const DOMAIN = 'observable-news/desk-bundle/v1\n';
export const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;      // 5 minutes
export const MAX_BUNDLE_AGE_MS = 30 * 24 * 3600 * 1000; // 30 days

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

// Deterministic JSON: object keys sorted recursively, no whitespace.
export function canonicalJSON(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJSON(value[k])).join(',') + '}';
}

export const objectSha256 = obj => sha256Hex(Buffer.from(canonicalJSON(obj), 'utf8'));

function signingInput(domain, obj) { return Buffer.from(domain + canonicalJSON(obj), 'utf8'); }

export function signObject(domain, obj, privateKey) {
  return sign(null, signingInput(domain, obj), privateKey).toString('base64');
}

// Shared Ed25519 check against a trust store:
// [{ keyId, publicKeyPem, notBefore?, notAfter?, revokedAt? }]
export function verifySignedObject({ domain, obj, signature, keyId, createdAt, trustStore, now }) {
  if (typeof signature !== 'string' || signature.length === 0) return 'signature-missing';
  const signer = (trustStore || []).find(k => k.keyId === keyId);
  if (!signer) return 'unknown-key';
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return 'created-at-invalid';
  if (created > now + MAX_CLOCK_SKEW_MS) return 'created-in-future';
  if (signer.notBefore && created < Date.parse(signer.notBefore)) return 'key-not-yet-valid';
  if (signer.notAfter && created > Date.parse(signer.notAfter)) return 'key-expired';
  if (signer.revokedAt && (now >= Date.parse(signer.revokedAt) || created >= Date.parse(signer.revokedAt))) return 'key-revoked';
  let ok = false;
  try { ok = verify(null, signingInput(domain, obj), createPublicKey(signer.publicKeyPem), Buffer.from(signature, 'base64')); } catch { ok = false; }
  return ok ? null : 'signature-invalid';
}

export function buildManifest({ bundleBytes, sequence, basedOn, sourceCommit, createdAt, keyId, schemaVersion = 1 }) {
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 99_999_999) throw new Error('sequence must be 1..99999999');
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error('sourceCommit must be a 40-char hex SHA');
  if (!basedOn || basedOn.sequence !== sequence - 1 || typeof basedOn.checkpointSha256 !== 'string') throw new Error('basedOn must name the current head');
  return {
    v: 2,
    kind: 'observable-desk-bundle',
    sha256: sha256Hex(bundleBytes),
    size: bundleBytes.length,
    sequence,
    basedOn: { sequence: basedOn.sequence, checkpointSha256: basedOn.checkpointSha256 },
    sourceCommit,
    createdAt,
    keyId,
    schemaVersion,
  };
}

export function signManifest(manifest, privateKey) { return signObject(DOMAIN, manifest, privateKey); }

// expected: { sequence, basedOn: { sequence, checkpointSha256 } } from the
// verified publication head. There is no caller-supplied "last sequence".
export function verifyBundle({ bundleBytes, manifest, signature, trustStore, expected, now = Date.now() }) {
  const fail = reason => ({ ok: false, reason });
  if (!manifest || manifest.v !== 2 || manifest.kind !== 'observable-desk-bundle') return fail('manifest-kind');
  if (!expected || !expected.basedOn) return fail('no-verified-head');

  const sigProblem = verifySignedObject({ domain: DOMAIN, obj: manifest, signature, keyId: manifest.keyId, createdAt: manifest.createdAt, trustStore, now });
  if (sigProblem) return fail(sigProblem);
  if (now - Date.parse(manifest.createdAt) > MAX_BUNDLE_AGE_MS) return fail('bundle-too-old');

  // Only after the signature is proven do we trust the manifest's fields.
  if (!Buffer.isBuffer(bundleBytes) || manifest.size !== bundleBytes.length) return fail('size-mismatch');
  if (manifest.sha256 !== sha256Hex(bundleBytes)) return fail('hash-mismatch');

  if (!Number.isSafeInteger(manifest.sequence) || manifest.sequence < 1 || manifest.sequence > 99_999_999) return fail('sequence-invalid');
  if (manifest.sequence < expected.sequence) return fail('replay-or-rollback');
  if (manifest.sequence > expected.sequence) return fail('sequence-gap');
  const b = manifest.basedOn || {};
  if (b.sequence !== expected.basedOn.sequence || b.checkpointSha256 !== expected.basedOn.checkpointSha256) return fail('based-on-mismatch');

  return { ok: true, reason: 'accepted', sequence: manifest.sequence };
}
