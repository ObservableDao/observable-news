// Approved-bundle authenticity for Observable News.
//
// Trust model (see docs/TRUST-BOUNDARY.md):
//   * The private desk repository signs each export with an Ed25519 key held
//     only as a repository secret there (DESK_SIGNING_KEY).
//   * The public repository trusts only the public keys listed in
//     config/desk-signers.json, which sits under the public ruleset.
//   * A valid signature proves the bundle was produced by a holder of the
//     signing key. It does NOT prove editorial quality; the content
//     allow-list and schema checks run independently afterwards.
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

export function buildManifest({ bundleBytes, sequence, sourceCommit, createdAt, keyId, schemaVersion = 1 }) {
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('sequence must be a positive integer');
  if (!/^[0-9a-f]{40}$/.test(sourceCommit)) throw new Error('sourceCommit must be a 40-char hex SHA');
  return {
    v: 1,
    kind: 'observable-desk-bundle',
    sha256: sha256Hex(bundleBytes),
    size: bundleBytes.length,
    sequence,
    sourceCommit,
    createdAt,
    keyId,
    schemaVersion,
  };
}

function signingInput(manifest) {
  return Buffer.from(DOMAIN + canonicalJSON(manifest), 'utf8');
}

export function signManifest(manifest, privateKey) {
  return sign(null, signingInput(manifest), privateKey).toString('base64');
}

// trustStore: [{ keyId, publicKeyPem, notBefore, notAfter, revokedAt? }]
export function verifyBundle({ bundleBytes, manifest, signature, trustStore, lastAcceptedSequence = 0, now = Date.now() }) {
  const fail = reason => ({ ok: false, reason });

  if (!manifest || manifest.v !== 1 || manifest.kind !== 'observable-desk-bundle') return fail('manifest-kind');
  if (typeof signature !== 'string' || signature.length === 0) return fail('signature-missing');

  const signer = (trustStore || []).find(k => k.keyId === manifest.keyId);
  if (!signer) return fail('unknown-key');

  const created = Date.parse(manifest.createdAt);
  if (!Number.isFinite(created)) return fail('created-at-invalid');
  if (created > now + MAX_CLOCK_SKEW_MS) return fail('created-in-future');
  if (now - created > MAX_BUNDLE_AGE_MS) return fail('bundle-too-old');
  if (signer.notBefore && created < Date.parse(signer.notBefore)) return fail('key-not-yet-valid');
  if (signer.notAfter && created > Date.parse(signer.notAfter)) return fail('key-expired');
  if (signer.revokedAt && (now >= Date.parse(signer.revokedAt) || created >= Date.parse(signer.revokedAt))) return fail('key-revoked');

  let sigOk = false;
  try {
    sigOk = verify(null, signingInput(manifest), createPublicKey(signer.publicKeyPem), Buffer.from(signature, 'base64'));
  } catch {
    sigOk = false;
  }
  if (!sigOk) return fail('signature-invalid');

  // Only after the signature is proven do we trust the manifest's hash.
  if (manifest.size !== bundleBytes.length) return fail('size-mismatch');
  if (manifest.sha256 !== sha256Hex(bundleBytes)) return fail('hash-mismatch');

  if (!Number.isSafeInteger(manifest.sequence) || manifest.sequence <= lastAcceptedSequence) return fail('replay-or-rollback');

  return { ok: true, reason: 'accepted', sequence: manifest.sequence };
}
