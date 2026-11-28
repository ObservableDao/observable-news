# M0 benchmarks

Harness: `node scripts/bench.mjs [--runs 20] [--pagefind]` (recorded synthetic feeds) and
`node scripts/bench-live.mjs` (real registered feeds and terms archive). Both run in
`.github/workflows/benchmark.yml` on standard GitHub runners. That workflow is read-only, with no secrets and no schedule;
results appear in the job summary and as artifacts.

Test set-up, as in the architecture: 80 sources, 2,000 items a day, 30 days of history, half the feeds
answering 304; archive of 5,000 group pages, 300 explainers and 365 editions; every stage 20 times.
All synthetic pages are labelled as such. 10% of synthetic sources have no display rights, and their
headlines carry a canary marker that must never appear in output.

## Local baseline (2-core sandbox, Node 22, 20 runs)

| Stage | p50 | p95 |
| --- | --- | --- |
| Collection, steady state (80 feeds, compute only) | 0.61 s | 0.72 s |
| Collection, cold start | 0.38 s | 0.44 s |
| Live-layer render (1,368 files) | 1.25 s | 1.45 s |
| Archive render (5,665 files) | 4.09 s | 5.03 s |

| Threshold | Result |
| --- | --- |
| Collection p95 ≤ 3 min | Pass on compute (network time comes from the live run) |
| Live-layer build p95 ≤ 6 min | Render passes; checks and deploy are measured at the hosted-testing gate |
| Archive + Pagefind ≤ 15 min | Measured on runners only |
| Static files at 12 months < 15,000 | 7,033 before the search index |
| State < 25 MB | **Fails at 30-day retention (28.5 MB)**; the pre-agreed consequence, pruning after 14 days, gives 13.3 MB |
| Canary headlines in output | 0 |

## Design changes the benchmark forced

* **Compact state.** Stored items keep only what later steps need: the title (only where display or grouping
  is permitted), the excerpt already cut to its licensed length, and the SimHash. The full summary is never
  stored. This took the state file from 93.6 MB to 28.5 MB.
* **Group pages only for groups with two or more independent publishers**, as the architecture specifies.
  The first draft rendered every active group (9,756 files per publish); now 1,368.
* **Retention: 14 days** (the architecture's consequence for an oversized state).

## Not measurable in M0

Deploy time, morning-edition trigger-to-live time and freshness all need the hosted-testing gate. Private
Actions minutes are an estimate: desk CI runs only on pull requests, and each export is about one billed
minute, so 2 exports a day is about 60 minutes a month, against a 200-minute budget. The renderer stands in
for Astro, so the M1 build must be re-benchmarked with the real templates.
