# Observable News — public repository (M0)

Free public news discovery and briefing site. "The world, in perspective."

M0 status: local-only and GitHub-based feasibility. No Cloudflare resources,
no R2, no deploy. Design baseline: the approved R4 prototype (unchanged).

* `src/bundle/` — approved-bundle signature verification and content rules
* `src/history/` — publication-history hash chain and mirror recovery
* `src/budget/` — layer-1 budget controls
* `scripts/` — forbidden-dependency scan, workflow lint, bundle acceptance CLI
* `config/` — rulesets and the desk signer trust store (empty until approved)
* `proposed-workflows/` — inactive until approved
* `docs/` — settings for approval, trust boundary, security tests

Run `npm test` (Node 22, no dependencies).
