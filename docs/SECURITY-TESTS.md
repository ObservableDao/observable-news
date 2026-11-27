# M0 security tests

Run locally: `npm test` (Node 22, no dependencies, no network).
Run of 27 November 2026 (revision 2.6 code): **79 passed, 0 failed, 0 skipped.**

| File | Tests | Covers |
| --- | --- | --- |
| `content-schema.test.mjs` | 36 | Strict content gate: N0 control + N1–N35 negative cases |
| `bundle-authenticity.test.mjs` | 10 | Test C (C0–C8) and A12 |
| `publish-crossrun.test.mjs` | 9 | X1–X9: anti-replay and transport across separate processes |
| `e2e-desk.test.mjs` | 1 | Real desk export CLI → publish run → acknowledgement → substitution rejected |
| `history-integrity.test.mjs` | 7 | Test D (D0–D6), chain and recovery logic |
| `history-mirror.test.mjs` | 6 | M1–M6: verifying mirror; disabled workflows stay disabled |
| `budget-mode.test.mjs` | 4 | B3–B6 budget harness |
| `scans.test.mjs` | 6 | Leftover-R2 scan, strict SHA-pin lint, active-workflow inventory, positive controls |

## Mutation check (do the tests catch a broken safeguard?)

Each safeguard was removed in turn and the suite re-run; the code was restored afterwards.

| Safeguard removed | Failing tests |
| --- | --- |
| Tag names cannot be reused | 3 |
| Manifest must be based on the current head | 1 |
| Sequence must not be older than head + 1 | 3 |
| Releases must be immutable | 1 |
| Checkpoint signature must verify | 1 |
| Published asset hashes must match the checkpoint | 1 |
| Post-publish re-verification | 2 |
| Semantic content rules (permissions, references, cross-links) | 10 |
| Mirror copies only verified batches | 2 |

## What the simulator does and does not prove

`src/transport/fs-store.mjs` models GitHub's documented immutable-release behaviour
(drafts have no tag; published assets are locked; a used tag name cannot be reused
after deletion). The cross-run tests prove the logic is correct *if GitHub behaves
as documented*. The live tests below confirm that GitHub does.

## Live tests still to run on GitHub (your login only, no new credentials)

| ID | Test | Pass criterion |
| --- | --- | --- |
| T-L1 | `GitHubReleaseStore` lists a published release and reports `immutable: true` | Field present and true; if absent, the gate fails closed (`not-immutable`) |
| T-L2 | Create a draft `pub-99999999`, delete it, create it again | Allowed (drafts do not burn tags) |
| T-L3 | Publish a test release, then try to add, replace and delete its assets | All refused |
| T-L4 | Delete that release, then publish a new release with the same tag | Refused: tag name was used by an immutable release |
| D-L1 | Move or delete a `history-*` or `pub-*` tag | Refused (immutable release + `protect-release-tags`) |
| D-L2 | `gh release verify <tag>` on a published test release | Release attestation verifies |
| S-L1 | Open a fork pull request | CI runs only after approval, with no secrets |
| S-L2 | Push directly to public main after rulesets are on | Rejected by `protect-main` |
| S-L3 | Billing: no Actions budget above $0, or a $0 budget with stop-usage | Confirmed by screenshot |
| P-L1 | `git ls-remote https://github.com/actions/setup-node refs/tags/v6.0.0` | Prints `2028fbc5c25fe9cf00d9f06a71cc4710d4507903` (only one independent source so far) |

## Still placeholders

* `scripts/build-history-batch.mjs`: history batch generator, fails closed. `history.yml` and
  `mirror-history.yml` have no schedule and `if: ${{ false }}` until it exists.
* `PIN_PUBLIC_COMMIT_SHA` in the desk's proposed `export.yml` and `mirror-history.yml`: filled in once the public repository has its first commit.
* `src/transport/github-store.mjs`: real GitHub client, not yet run against GitHub (T-L1 to T-L4).
* Trust stores `config/desk-signers.json` and `config/checkpoint-signers.json`: empty until key generation is approved. With empty stores every bundle and checkpoint is rejected.
