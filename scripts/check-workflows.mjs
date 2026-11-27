// Security lint for GitHub Actions workflow files (active and proposed).
// Usage: node scripts/check-workflows.mjs <dir> [<dir>...] [--pins config/pinned-actions.json] [--allow-unpinned]
// Rules: explicit top-level permissions; no pull_request_target; no secrets in
// pull-request-triggered workflows; no write-all; every action pinned to the
// exact full commit SHA recorded in the pin list (unknown actions rejected).
// Placeholders (PIN_...) are reported as warnings: they mark values that only
// exist after the repositories are created.
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const allowUnpinned = args.includes('--allow-unpinned');
const pinsAt = args.indexOf('--pins');
const pinsPath = pinsAt >= 0 ? args[pinsAt + 1] : join(dirname(fileURLToPath(import.meta.url)), '..', 'config', 'pinned-actions.json');
const dirs = args.filter((a, i) => !a.startsWith('--') && !(pinsAt >= 0 && i === pinsAt + 1));
const pins = JSON.parse(readFileSync(pinsPath, 'utf8')).actions;
const problems = []; const warnings = []; let count = 0;

for (const dir of dirs) {
  let files = []; try { files = readdirSync(dir).filter(f => /\.ya?ml$/.test(f)); } catch { continue; }
  for (const f of files) {
    count++;
    const path = join(dir, f); const text = readFileSync(path, 'utf8');
    const onBlock = text.split(/\n(?=\S)/).find(b => /^on:/.test(b)) || '';
    if (!/^permissions:/m.test(text)) problems.push(`${path}: no top-level permissions block`);
    if (/pull_request_target/.test(text)) problems.push(`${path}: uses pull_request_target`);
    if (/write-all/.test(text)) problems.push(`${path}: uses write-all`);
    if (/\bpull_request\b/.test(onBlock) && /secrets\./.test(text)) problems.push(`${path}: pull-request workflow references secrets`);
    for (const m of text.matchAll(/\bPIN_[A-Z_]+/g)) warnings.push(`${path}: placeholder ${m[0]} must be filled in before enabling`);
    for (const m of text.matchAll(/uses:\s*([^\s#]+)/g)) {
      const ref = m[1];
      if (ref.startsWith('./')) continue;
      const [action, sha] = ref.split('@');
      const pin = pins[action];
      const bad = !pin ? `action not in the pin list: ${ref}`
        : !/^[0-9a-f]{40}$/.test(sha || '') ? `action not pinned to a full commit SHA: ${ref}`
        : sha !== pin.sha ? `action pinned to an unverified SHA: ${ref}` : null;
      if (bad) (allowUnpinned ? warnings : problems).push(`${path}: ${bad}`);
    }
  }
}
console.log(`workflow security lint: ${count} workflow file(s), ${problems.length} problem(s), ${warnings.length} warning(s)`);
for (const p of problems) console.log('  PROBLEM ' + p);
for (const w of warnings) console.log('  WARNING ' + w);
process.exit(problems.length ? 1 : 0);
