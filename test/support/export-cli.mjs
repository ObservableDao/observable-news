// Test-only desk simulator, run as its own process (one simulated export run).
// Usage: node test/support/export-cli.mjs <content.json> --store fs:<dir> --checkpoint-signers <path> [--skip-advisory 1]
// Env: DESK_SIGNING_KEY, DESK_KEY_ID (ephemeral test keys).
import { readFileSync } from 'node:fs';
import { createPrivateKey } from 'node:crypto';
import { canonicalJSON } from '../../src/bundle/signature.mjs';
import { exportBundle } from '../../src/publish/export.mjs';
import { storeFromSpec } from '../../src/transport/github-store.mjs';
import { parseArgs, loadTrust } from '../../scripts/lib/cli.mjs';

const a = parseArgs(process.argv.slice(2));
const r = await exportBundle({
  store: await storeFromSpec(a.store),
  checkpointTrust: loadTrust(a['checkpoint-signers']),
  bundleBytes: Buffer.from(canonicalJSON(JSON.parse(readFileSync(a._[0], 'utf8'))), 'utf8'),
  sourceCommit: 'b'.repeat(40),
  deskKey: createPrivateKey(process.env.DESK_SIGNING_KEY),
  deskKeyId: process.env.DESK_KEY_ID,
  advisory: !a['skip-advisory'],
});
const { files, ...out } = r;
console.log(JSON.stringify(out));
process.exit(r.ok ? 0 : r.reason === 'public-state-halted' ? 3 : 1);
