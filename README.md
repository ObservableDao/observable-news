# Observable News — public repository (M0)

Free public news discovery and briefing site. "The world, in perspective."

M0 status: local-only and GitHub-based feasibility. No Cloudflare resources,
no R2, no deploy. Design baseline: the approved R4 prototype (unchanged).

* `src/content/`, `src/bundle/` — strict content schema, bundle signature checks
* `src/publish/` — signed publication checkpoints (durable anti-replay), publish gate, recovery, export, acknowledgement
* `src/transport/` — release store: GitHub REST client and an immutable-release simulator for tests
* `src/history/` — publication-history hash chain and the verifying mirror
* `src/budget/` — layer-1 budget controls
* `scripts/` — CLIs for each workflow, forbidden-dependency scan, workflow lint
* `config/` — rulesets, trust stores (empty until approved), verified action pins
* `proposed-workflows/` — inactive until approved; `history.yml` is also disabled
* `docs/` — settings for approval, trust boundary, security tests, push checklist

Run `npm test` (Node 22, no dependencies).
