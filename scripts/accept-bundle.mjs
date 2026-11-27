// CLI used by the publish workflow: accept the newest desk bundle or fail closed.
// Usage: node scripts/accept-bundle.mjs <incomingDir> <trustStore.json> [lastSequenceFile]
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { acceptBundle } from '../src/bundle/accept.mjs';

const [dir, storePath, seqFile = 'state/last-bundle-sequence.txt'] = process.argv.slice(2);
const trustStore = JSON.parse(readFileSync(storePath, 'utf8')).keys || [];
const last = existsSync(seqFile) ? Number(readFileSync(seqFile, 'utf8')) : 0;

const bundles = readdirSync(dir).filter(f => /^desk-bundle-\d+\.json$/.test(f))
  .map(f => Number(f.match(/\d+/)[0])).sort((a, b) => b - a);
if (!bundles.length) { console.log('no bundle found'); process.exit(1); }
const n = bundles[0];
const result = acceptBundle({
  bundleBytes: readFileSync(join(dir, `desk-bundle-${n}.json`)),
  manifest: JSON.parse(readFileSync(join(dir, `desk-bundle-${n}.manifest.json`), 'utf8')),
  signature: readFileSync(join(dir, `desk-bundle-${n}.sig`), 'utf8').trim(),
  trustStore, lastAcceptedSequence: last,
});
// Log the decision only, never bundle content.
console.log(JSON.stringify({ bundle: n, ok: result.ok, stage: result.stage || null, reason: result.reason || null }));
if (!result.ok) process.exit(1);
writeFileSync(seqFile, String(result.sequence));
