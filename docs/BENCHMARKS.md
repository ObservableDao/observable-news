# M0 benchmarks

Harness: `node scripts/bench.mjs [--runs 20] [--pagefind]` (recorded synthetic feeds) and
`node scripts/bench-live.mjs` (real registered feeds and terms archive), in `.github/workflows/benchmark.yml`.
That workflow is read-only, with no secrets and no schedule. The synthetic job runs on pull requests. The live
job, which contacts publishers, runs **only when started by hand on `main`**. Every live request goes through
`src/ingest/fetcher.mjs`, which checks robots.txt before each request and each redirect hop.

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

## GitHub runner results (ubuntu-latest, 4 cores, Node 22, 20 runs per stage)

| Stage | p50 | p95 | Threshold | Result |
| --- | --- | --- | --- | --- |
| Collection, steady state (compute) | 0.49 s | 0.53 s | ≤ 3 min | Pass |
| Collection over the real network (7 live feeds) | 4.1 s | 4.4 s (2 runs) | ≤ 3 min | Pass |
| Live-layer render (1,368 files) | 0.31 s | 0.33 s | ≤ 6 min incl. deploy | Pass (render only) |
| Archive render (5,665 files) | 0.77 s | 0.83 s | | |
| Pagefind 1.6.0 over the archive | 2.65 s | 2.68 s | | |
| Archive + Pagefind | | 3.5 s | ≤ 15 min | Pass |
| Static files at 12 months | 12,765 | | < 15,000 | Pass (Pagefind adds 5,732) |
| State at 30-day retention | 28.5 MB | | < 25 MB | Fail → 14-day retention |
| State at 14-day retention | 13.3 MB | | < 25 MB | Pass |
| Canary headlines in output | 0 | | 0 | Pass |

Peak memory was about 1.2 GB. The live job fetched only sources whose Fetch right is confirmed. Every feed
except Tech Policy Press answers conditional requests with 304. Tech Policy Press serves an 870 KB feed of
300 items going back to 2023, with no 304, so it is the costliest feed per run.

**Real volume is far below the design load.** Confirmed independent sources: about 15 items a day
(Mongabay ~13.5, Global Voices ~1.3, Tech Policy Press ~0.3, Liberty Investigates 0). Government and
institutional: GOV.UK ~37 (its feed holds only the newest 20, so collection every 15 minutes keeps up),
ONS ~9, NASA ~5. Compute is not the constraint; content is (see `docs/sources/SOURCE-AUDIT.md`).

**Cadence.** Collection takes seconds and every threshold has large headroom, so the proposed 15-minute
cadence stands. The 30-minute fallback is not needed.

## Design changes the benchmark forced

* **Compact state.** Stored items keep only what later steps need: the title (only where display or grouping
  is permitted), the excerpt already cut to its licensed length, and the SimHash. The full summary is never
  stored. This took the state file from 93.6 MB to 28.5 MB.
* **Group pages only for groups with two or more independent publishers**, as the architecture specifies.
  The first draft rendered every active group (9,756 files per publish); now 1,368.
* **Retention: 14 days** (the architecture's consequence for an oversized state).
* **Review fixes (PR #8):** robots.txt is checked before every request and redirect (RFC 9309: an unreachable
  robots.txt means "disallow"); 14-day retention is the code default; item links must be on the source's own host
  (the "last two labels" shortcut wrongly matched any two `.co.uk` or `.org.uk` sites); missing, invalid or
  impossible dates are quarantined, since `Date.parse` turned "31 Febtember 2026" into 3 March; group ids continue from
  a stored counter, so a gap of more than 48 hours cannot reuse old ids.
* **Stale items are skipped at ingest.** The first live run found a feed whose old items were pruned
  and re-added as new on every run.
* **Terms evidence gets two hashes:** the raw copy changes on every fetch for dynamic pages, so a hash of the
  visible text is used to detect real changes. It was identical across runs for all 7 archived sources.

## Not measurable in M0

Deploy time, morning-edition trigger-to-live time and freshness all need the hosted-testing gate. Private
Actions minutes are an estimate: desk CI runs only on pull requests, and each export is about one billed
minute, so 2 exports a day is about 60 minutes a month, against a 200-minute budget. The renderer stands in
for Astro, so the M1 build must be re-benchmarked with the real templates.
