# M0 security tests

Run locally: `npm test` (Node 22, no dependencies).
Results of the run on 27 November 2026: **26 passed, 0 failed, 0 skipped.**

| Group | Tests | Where |
| --- | --- | --- |
| C — approved-bundle authenticity | C0–C8 | `test/bundle-authenticity.test.mjs` |
| A12 — private-side boundary | A12 | `test/bundle-authenticity.test.mjs` |
| End-to-end desk export → public gate | 1 | `test/e2e-desk.test.mjs` |
| D — publication-history integrity (local) | D0–D6 | `test/history-integrity.test.mjs` |
| B — budget monitor (harness part) | B3–B6 | `test/budget-mode.test.mjs` |
| Leftover-R2 scan and workflow lint, with positive controls | 4 | `test/scans.test.mjs` |

## Live tests still to run (need the repositories on GitHub; no credentials beyond your own login)

| ID | Test | Pass criterion |
| --- | --- | --- |
| D-L1 | Try to replace or delete an asset of a published immutable `history-*` release | Refused by GitHub |
| D-L2 | Try to move or delete a `history-*` tag | Refused (immutable release + tag ruleset) |
| D-L3 | Delete a whole test release as administrator, then recreate the same tag | Deletion possible; tag name cannot be reused; chain verifier reports the gap; mirror restore passes |
| D-L4 | `gh release verify <tag>` on a history release | Release attestation verifies |
| S-L1 | Open a fork pull request | CI runs only after approval, with no secrets |
| S-L2 | Push directly to public main | Rejected by `protect-main` |
| S-L3 | Billing: confirm no Actions budget above $0 (or a $0 stop-usage budget) | Confirmed by screenshot |

## Known gate before enabling any workflow

`scripts/check-workflows.mjs` (strict) currently reports 7 unpinned `actions/checkout@v4`
references across both repositories. These must be pinned to full commit SHAs at provisioning.
