// Fails if any active file references R2 or another metered Cloudflare product
// that Observable must not use without explicit approval.
// Usage: node scripts/check-forbidden.mjs <repoDir> [--json]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.argv[2] || '.';
// Scope: what can actually run or deploy. Docs and test fixtures are excluded.
const SCAN_DIRS = ['.github', 'proposed-workflows', 'src', 'scripts', 'config', 'content'];
const SCAN_FILES = ['package.json', 'wrangler.toml', 'wrangler.json', 'wrangler.jsonc'];
const SELF = 'scripts/check-forbidden.mjs';

const RULES = [
  [/\bR2\b/, 'R2 reference'],
  [/r2_buckets|\[\[r2/i, 'R2 binding'],
  [/obs-state|obs-desk-export/, 'retired R2 bucket name'],
  [/r2\.cloudflarestorage\.com|r2\.dev/i, 'R2 endpoint'],
  [/@aws-sdk|S3Client|\bs3api\b|aws s3 /i, 'S3 client (R2 API)'],
  [/d1_databases|\[\[d1/i, 'D1 binding'],
  [/kv_namespaces|\[\[kv/i, 'KV binding'],
  [/\[\[queues|"queues"\s*:/i, 'Queues binding'],
  [/"ai"\s*:\s*\{|\[ai\]/i, 'Workers AI binding'],
  [/"durable_objects"|\[\[durable_objects/i, 'Durable Objects binding'],
  [/"triggers"\s*:\s*\{\s*"crons"|\[triggers\]/i, 'Cron Trigger'],
  [/wrangler\s+(deploy|versions)/i, 'Cloudflare deploy command (not permitted in M0)'],
  [/cloudflareaccess\.com|zero[- ]trust/i, 'Cloudflare Access / Zero Trust'],
];

function walk(dir, out) {
  let entries; try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e);
    const s = statSync(p);
    if (s.isDirectory()) { if (e !== 'node_modules' && e !== 'fixtures') walk(p, out); }
    else out.push(p);
  }
}

const files = [];
for (const d of SCAN_DIRS) walk(join(ROOT, d), files);
for (const f of SCAN_FILES) { try { statSync(join(ROOT, f)); files.push(join(ROOT, f)); } catch { /* absent */ } }

const findings = [];
for (const f of files) {
  const rel = relative(ROOT, f).replaceAll('\\', '/');
  if (rel === SELF) continue;
  const lines = readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const [re, label] of RULES) if (re.test(line)) findings.push({ file: rel, line: i + 1, rule: label });
  });
}

if (process.argv.includes('--json')) console.log(JSON.stringify({ scanned: files.length, findings }));
else {
  console.log(`forbidden-dependency scan: ${files.length} files scanned, ${findings.length} finding(s)`);
  for (const x of findings) console.log(`  ${x.file}:${x.line}  ${x.rule}`);
}
process.exit(findings.length ? 1 : 0);
