// Prints the M0 source-coverage verdict computed from config/sources.json.
// Usage: node scripts/source-coverage.mjs [--json] [config/sources.json]
import { readFileSync } from 'node:fs';
import { validateRegister, coverage, SECTION_NAMES } from '../src/sources/register.mjs';

const args = process.argv.slice(2);
const path = args.find(a => !a.startsWith('--')) || 'config/sources.json';
const reg = JSON.parse(readFileSync(path, 'utf8'));
const v = validateRegister(reg);
if (!v.ok) { console.error('register invalid:\n  ' + v.errors.join('\n  ')); process.exit(1); }
const byLicence = coverage(reg), withEvidence = coverage(reg, { strict: true });
if (args.includes('--json')) { console.log(JSON.stringify({ byLicence, withEvidence }, null, 2)); process.exit(0); }

const line = (c) => {
  console.log(`  Audited sources: ${c.audited} (target 40); terms archived: ${c.archived}`);
  for (const [sec, s] of Object.entries(c.perSection)) console.log(`  ${(SECTION_NAMES[sec] + ':').padEnd(17)} ${s.count} headline sources${s.meets ? '' : ' (needs 3)'}  [${s.sources.join(', ')}]`);
  console.log(`  Independent news organisations: ${c.independent.organisations} across ${c.independent.sections.length} sections (needs 5 across 3) -> ${c.independent.meets ? 'met' : 'not met'}`);
  console.log(`  Gate: ${c.gate}`);
};
console.log('By published licence or terms:'); line(byLicence);
console.log('\nWith archived evidence (strict M0 gate):'); line(withEvidence);
console.log(`\nPending headline rights (outreach): ${byLicence.pending.join(', ')}`);
