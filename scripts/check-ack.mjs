// Usage: node scripts/check-ack.mjs --store <spec> --sequence N --bundle-sha <hex> [--checkpoint-signers <path>]
// Exit 0 only when acknowledged.
import { storeFromSpec } from '../src/transport/github-store.mjs';
import { checkAck } from '../src/publish/ack.mjs';
import { parseArgs, loadTrust, report } from './lib/cli.mjs';

const a = parseArgs(process.argv.slice(2));
const r = await checkAck({ store: await storeFromSpec(a.store), checkpointTrust: loadTrust(a['checkpoint-signers'] || 'config/checkpoint-signers.json'),
  sequence: Number(a.sequence), bundleSha256: a['bundle-sha'] });
report(r);
process.exit(r.state === 'acknowledged' ? 0 : 1);
