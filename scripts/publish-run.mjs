// One publish run (used by proposed-workflows/publish.yml).
// Usage: node scripts/publish-run.mjs --store <fs:dir|github:owner/repo>
//          [--desk-signers config/desk-signers.json] [--checkpoint-signers config/checkpoint-signers.json]
// Env:   CHECKPOINT_SIGNING_KEY (Ed25519 PKCS#8 PEM; production environment secret)
//        CHECKPOINT_KEY_ID, GITHUB_RUN_ID, GH_TOKEN (github store only)
// Exit:  0 accepted or nothing to do, 1 rejected, 2 halted (needs an operator).
import { storeFromSpec } from '../src/transport/github-store.mjs';
import { runPublish } from '../src/publish/gate.mjs';
import { parseArgs, loadTrust, keyFromEnv, report } from './lib/cli.mjs';

const a = parseArgs(process.argv.slice(2));
const store = await storeFromSpec(a.store);
const result = await runPublish({
  store,
  deskTrust: loadTrust(a['desk-signers'] || 'config/desk-signers.json'),
  checkpointTrust: loadTrust(a['checkpoint-signers'] || 'config/checkpoint-signers.json'),
  checkpointKey: keyFromEnv('CHECKPOINT_SIGNING_KEY'),
  checkpointKeyId: process.env.CHECKPOINT_KEY_ID,
  runId: process.env.GITHUB_RUN_ID || 'local',
});
const { errors, ...decision } = result;
report({ ...decision, errorCount: errors ? errors.length : undefined, errors: errors?.slice(0, 20) });
process.exit(result.status === 'accepted' || result.status === 'nothing-to-do' ? 0 : result.status === 'rejected' ? 1 : 2);
