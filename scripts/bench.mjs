// M0 benchmark harness (architecture "Benchmarks before commitments").
// Usage: node scripts/bench.mjs [--runs 20] [--pagefind] [--out bench-out]
// Every stage runs --runs times (default 20). Pagefind runs only with --pagefind
// (it is downloaded by npx on GitHub runners; this repository adds no dependency).
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, statSync, appendFileSync } from 'node:fs';
import { tmpdir, cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { collect, emptyState } from '../src/ingest/collect.mjs';
import { renderLive, renderArchive } from '../src/build/render.mjs';
import { makeTimeline, recordedResponses, rssFor, archiveInputs, CANARY } from '../bench/fixtures.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const RUNS = Number(arg('runs', 20));
const OUT = arg('out', 'bench-out');
const PAGEFIND = process.argv.includes('--pagefind');
const PAGEFIND_RUNS = Number(process.env.PAGEFIND_RUNS || RUNS);
const PAGEFIND_VERSION = '1.6.0';

const T = Date.parse('2026-11-28T12:00:00Z');
const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]; };
const summary = xs => ({ runs: xs.length, p50: +pct(xs, 0.5).toFixed(1), p95: +pct(xs, 0.95).toFixed(1), max: +Math.max(...xs).toFixed(1) });
async function stage(name, fn) {
  const times = []; let last;
  for (let i = 0; i < RUNS; i++) { const t0 = performance.now(); last = await fn(i); times.push(performance.now() - t0); }
  console.error(`  ${name}: p95 ${pct(times, 0.95).toFixed(0)} ms`);
  return { ms: summary(times), last };
}
function walk(dir) { let files = 0, bytes = 0; for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) { const r = walk(p); files += r.files; bytes += r.bytes; } else { files++; bytes += statSync(p).size; } } return { files, bytes }; }
function grepDir(dir, needle) { let hits = 0; for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) hits += grepDir(p, needle); else if (readFileUtf8(p).includes(needle)) hits++; } return hits; }
import { readFileSync } from 'node:fs';
const readFileUtf8 = p => readFileSync(p, 'utf8');

console.error(`Observable News M0 benchmarks: ${RUNS} runs per stage`);
const timeline = makeTimeline({ start: T - 30 * 86400_000, end: T + 15 * 60_000 });
const register = timeline.register;

// Pre-warm 30 days of state (everything before the last 15 minutes).
const history = new Map();
for (const it of timeline.items) if (Date.parse(it.published) < T - 15 * 60_000) { const l = history.get(it.source.id) || []; l.push(it); history.set(it.source.id, l); }
const warm = await collect({ register, state: emptyState(), now: T - 15 * 60_000, fetchSource: async s => ({ status: 200, body: Buffer.from(rssFor(s, history.get(s.id) || [])) }) });
const warmJson = JSON.stringify(warm.state);

// Recorded responses at T: 50 newest per feed; half the feeds unchanged (304).
const steady = recordedResponses(timeline, T + 15 * 60_000);
const coldResponses = recordedResponses(timeline, T + 15 * 60_000, { unchangedShare: 0 });
const replay = map => async s => map.get(s.id);

const results = { generatedAt: new Date().toISOString(), environment: { node: process.version, platform: process.platform, cpu: cpus()[0]?.model, cores: cpus().length, memoryGB: +(totalmem() / 2 ** 30).toFixed(1), runner: process.env.RUNNER_NAME || null, runId: process.env.GITHUB_RUN_ID || null }, inputs: { sources: 80, itemsPerDay: 2000, historyDays: 30, stateItems: Object.keys(warm.state.items).length, stateGroups: Object.keys(warm.state.groups).length }, stages: {} };

let steadyStats;
const coll = await stage('collection (steady state)', async () => {
  const state = JSON.parse(warmJson);
  const r = await collect({ register, state, now: T + 15 * 60_000, fetchSource: replay(steady) });
  steadyStats = r.stats;
  return JSON.stringify(r.state);
});
results.stages.collection = { ...coll.ms, stats: steadyStats, snapshotBytes: Buffer.byteLength(coll.last) };
// Pre-agreed consequence if the state is too large: prune after 14 days instead of 30.
const pruned14 = await collect({ register, state: JSON.parse(warmJson), now: T + 15 * 60_000, fetchSource: replay(steady), retentionDays: 14 });
results.stages.collection.snapshotBytes14d = Buffer.byteLength(JSON.stringify(pruned14.state));
results.grouping = { warmItems: warm.stats.newItems, groupsCreated: warm.stats.groupsCreated, joinedExisting: warm.stats.joinedExisting, comparisons: warm.stats.comparisons };
let coldStats;
const cold = await stage('collection (cold start)', async () => { const r = await collect({ register, state: emptyState(), now: T + 15 * 60_000, fetchSource: replay(coldResponses) }); coldStats = r.stats; return r; });
results.stages.collectionCold = { ...cold.ms, stats: coldStats };

const liveState = JSON.parse(coll.last);
mkdirSync(OUT, { recursive: true });
let liveDir;
const live = await stage('live-layer build', async i => { if (liveDir) rmSync(liveDir, { recursive: true, force: true }); liveDir = mkdtempSync(join(tmpdir(), `live-${i}-`)); return renderLive(liveState, register, liveDir, T + 15 * 60_000); });
results.stages.liveBuild = { ...live.ms, files: live.last.files, bytes: live.last.bytes, groupPages: live.last.groupPages, activeGroups: live.last.activeGroups, canaryHits: grepDir(liveDir, CANARY) };

const archive = archiveInputs();
let archDir;
const arch = await stage('archive build (5,000 groups, 300 explainers, 365 editions)', async i => { if (archDir) rmSync(archDir, { recursive: true, force: true }); archDir = mkdtempSync(join(tmpdir(), `arch-${i}-`)); return renderArchive(archive, archDir); });
results.stages.archiveBuild = { ...arch.ms, files: arch.last.files, bytes: arch.last.bytes };

if (PAGEFIND) {
  const times = []; let ok = true, out = '';
  for (let i = 0; i < PAGEFIND_RUNS && ok; i++) {
    rmSync(join(archDir, 'pagefind'), { recursive: true, force: true });
    const t0 = performance.now();
    const r = spawnSync('npx', ['--yes', `pagefind@${PAGEFIND_VERSION}`, '--site', archDir], { encoding: 'utf8' });
    times.push(performance.now() - t0); ok = r.status === 0; out = (r.stderr || r.stdout || '').slice(-400);
  }
  const idx = ok ? walk(join(archDir, 'pagefind')) : { files: 0, bytes: 0 };
  results.stages.pagefind = ok ? { ...summary(times), version: PAGEFIND_VERSION, indexFiles: idx.files, indexBytes: idx.bytes, note: 'first run includes the npx download' } : { error: out };
}
results.peakRssMB = +(process.resourceUsage().maxRSS / 1024).toFixed(0);

// Thresholds (architecture). Only what M0 can measure without a hosted deploy.
const pf = results.stages.pagefind && !results.stages.pagefind.error ? results.stages.pagefind : null;
const staticFiles = results.stages.archiveBuild.files + results.stages.liveBuild.files + (pf ? pf.indexFiles : 0);
results.thresholds = [
  { measure: 'Collection compute, p95 (excludes network; see live run)', limit: '≤ 180,000 ms', value: results.stages.collection.p95, pass: results.stages.collection.p95 <= 180_000 },
  { measure: 'Live-layer render, p95 (checks and deploy not in M0)', limit: '≤ 360,000 ms', value: results.stages.liveBuild.p95, pass: results.stages.liveBuild.p95 <= 360_000 },
  { measure: 'Full archive build + Pagefind, p95', limit: '≤ 900,000 ms', value: pf ? +(results.stages.archiveBuild.p95 + pf.p95).toFixed(1) : null, pass: pf ? results.stages.archiveBuild.p95 + pf.p95 <= 900_000 : null },
  { measure: 'Static file count at 12 months', limit: '< 15,000', value: staticFiles, pass: pf ? staticFiles < 15_000 : null },
  { measure: 'State file size at 12 months (30-day retention, uncompressed)', limit: '< 25 MB', value: +(results.stages.collection.snapshotBytes / 2 ** 20).toFixed(2), pass: results.stages.collection.snapshotBytes < 25 * 2 ** 20, consequence: 'prune after 14 days' },
  { measure: 'State file size with the 14-day consequence applied', limit: '< 25 MB', value: +(results.stages.collection.snapshotBytes14d / 2 ** 20).toFixed(2), pass: results.stages.collection.snapshotBytes14d < 25 * 2 ** 20 },
  { measure: 'Canary headlines without display rights in output', limit: '0', value: results.stages.liveBuild.canaryHits, pass: results.stages.liveBuild.canaryHits === 0 },
];
rmSync(liveDir, { recursive: true, force: true }); rmSync(archDir, { recursive: true, force: true });

writeFileSync(join(OUT, 'fixtures.json'), JSON.stringify(results, null, 2));
const md = [`### M0 fixture benchmarks (${RUNS} runs per stage, Node ${process.version}, ${results.environment.cores} cores)`, '',
  '| Stage | p50 ms | p95 ms | max ms | Notes |', '| --- | --- | --- | --- | --- |',
  ...Object.entries(results.stages).filter(([, s]) => s.p50 !== undefined).map(([k, s]) => `| ${k} | ${s.p50} | ${s.p95} | ${s.max} | ${s.files ? `${s.files} files, ${(s.bytes / 2 ** 20).toFixed(1)} MB` : s.snapshotBytes ? `state ${(s.snapshotBytes / 2 ** 20).toFixed(2)} MB` : s.indexFiles ? `${s.indexFiles} index files` : ''} |`),
  '', '| Threshold | Limit | Measured | Result |', '| --- | --- | --- | --- |',
  ...results.thresholds.map(t => `| ${t.measure} | ${t.limit} | ${t.value ?? 'n/a'} | ${t.pass === null ? 'not measured here' : t.pass ? 'pass' : `FAIL${t.consequence ? ` → ${t.consequence}` : ''}`} |`),
  '', `Grouping over 30 days: ${results.grouping.warmItems} items formed ${results.grouping.groupsCreated} groups (${results.grouping.joinedExisting} items joined an existing group). Live layer: ${results.stages.liveBuild.groupPages} group pages out of ${results.stages.liveBuild.activeGroups} active groups (2+ publishers only).`,
  '', `Steady-state run: ${steadyStats.feeds} feeds, ${steadyStats.notModified} unchanged, ${steadyStats.parsed} items parsed, ${steadyStats.newItems} new, ${steadyStats.quarantined} quarantined, ${steadyStats.joinedExisting} joined existing groups. Peak RSS ${results.peakRssMB} MB.`].join('\n');
writeFileSync(join(OUT, 'fixtures.md'), md + '\n');
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
console.log(md);
process.exit(results.thresholds.some(t => t.pass === false && !t.consequence) ? 1 : 0);
