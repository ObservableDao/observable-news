// Daily verifying mirror (used by observable-news-desk/proposed-workflows/mirror-history.yml).
// Usage: node scripts/mirror-history.mjs --source <spec> --mirror <spec> [--checkpoint-signers <path>]
// Verifies the history hash chain before copying anything, and audits the
// whole publication checkpoint chain (pub-*). Exit 1 on any problem.
import { storeFromSpec } from '../src/transport/github-store.mjs';
import { mirrorHistory } from '../src/history/mirror.mjs';
import { readHead } from '../src/publish/checkpoint.mjs';
import { parseArgs, loadTrust, report } from './lib/cli.mjs';

const a = parseArgs(process.argv.slice(2));
const source = await storeFromSpec(a.source);
const history = await mirrorHistory({ source, mirror: await storeFromSpec(a.mirror) });
let publications = null;
if (a['checkpoint-signers']) {
  const st = await readHead(source, loadTrust(a['checkpoint-signers']), { depth: Infinity });
  publications = st.ok ? { ok: true, head: st.head.sequence, verified: st.verified.length } : { ok: false, problems: st.problems };
}
report({ history, publications });
process.exit(history.ok && (!publications || publications.ok) ? 0 : 1);
