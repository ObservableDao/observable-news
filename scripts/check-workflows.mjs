// Security lint for GitHub Actions workflow files (active and proposed).
// Usage: node scripts/check-workflows.mjs <dir> [<dir>...] [--allow-unpinned]
// Rules: explicit top-level permissions; no pull_request_target; no secrets in
// pull-request-triggered workflows; no write-all; actions pinned to full SHAs.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const allowUnpinned = args.includes('--allow-unpinned');
const dirs = args.filter(a => !a.startsWith('--'));
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
    for (const m of text.matchAll(/uses:\s*([^\s#]+)/g)) {
      const ref = m[1];
      if (ref.startsWith('./')) continue;
      if (!/@[0-9a-f]{40}$/.test(ref)) (allowUnpinned ? warnings : problems).push(`${path}: action not pinned to a full commit SHA: ${ref}`);
    }
  }
}
console.log(`workflow security lint: ${count} workflow file(s), ${problems.length} problem(s), ${warnings.length} warning(s)`);
for (const p of problems) console.log('  PROBLEM ' + p);
for (const w of warnings) console.log('  WARNING ' + w);
process.exit(problems.length ? 1 : 0);
