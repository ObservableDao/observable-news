// Manual recovery (proposed-workflows/recover.yml, workflow_dispatch only).
// Usage: node scripts/recover-skip.mjs --store <spec> --reason <forged-release|deleted-release|asset-swap|operator>
//          --expect-base <sequence> [--checkpoint-signers config/checkpoint-signers.json]
// The operator must state the last good sequence; the run refuses if it differs.
import { storeFromSpec } from '../src/transport/github-store.mjs';
import { runSkip } from '../src/publish/gate.mjs';
import { parseArgs, loadTrust, keyFromEnv, report } from './lib/cli.mjs';

const a = parseArgs(process.argv.slice(2));
const result = await runSkip({
  store: await storeFromSpec(a.store),
  checkpointTrust: loadTrust(a['checkpoint-signers'] || 'config/checkpoint-signers.json'),
  checkpointKey: keyFromEnv('CHECKPOINT_SIGNING_KEY'),
  checkpointKeyId: process.env.CHECKPOINT_KEY_ID,
  runId: process.env.GITHUB_RUN_ID || 'local',
  reason: a.reason,
  expectBase: Number(a['expect-base']),
});
report(result);
process.exit(result.status === 'skipped' ? 0 : 2);
