# M0 settings for approval

Nothing in this file has been applied. Each section needs your explicit approval.
No R2, Cloudflare Access, Workers, paid services or changes to Daymark or
Observable Dao are involved.

## Stage 1 — approved: repositories, public rules, local environment

### ObservableDao/observable-news (public)

| Setting | Value |
| --- | --- |
| Visibility | Public |
| Settings → General → Releases | **Enable release immutability** before any `pub-*` or `history-*` release exists (applies to future releases only; the gate refuses non-immutable releases) |
| Settings → Actions → General → Actions permissions | Allow ObservableDao actions and select non-ObservableDao actions: only `actions/checkout@1af3b93b6815bc44a9784bd300feb67ff0d1eeb3` (v6.0.0) and `actions/setup-node@2028fbc5c25fe9cf00d9f06a71cc4710d4507903` (v6.0.0). Tick "Require actions to be pinned to a full-length commit SHA" if offered |
| Settings → Actions → General → Fork pull request workflows | Require approval for all external contributors |
| Settings → Actions → General → Workflow permissions | Read repository contents and packages permissions; "Allow GitHub Actions to create and approve pull requests" **off** |
| Settings → Rules → Rulesets | After the first push, import `config/rulesets/protect-main.json` and `config/rulesets/protect-release-tags.json` (`history-*` and `pub-*`), bypass list empty |
| Settings → Code security | Secret scanning and push protection **on**; Dependabot alerts **on** |
| Settings → Environments | `production`: deployment branches = `main` only; no secrets yet; no required reviewer (publishing is unattended) |
| Collaborators | None |

### ObservableDao/observable-news-desk (private, GitHub Free)

| Setting | Value |
| --- | --- |
| Visibility | Private |
| Collaborators | None (you only) |
| Settings → Actions → General → Workflow permissions | Read repository contents; PR creation/approval **off** |
| Fork pull request workflows (private) | **Off** (default) |
| Rulesets / branch protection / environments | **Not available on GitHub Free for private repositories — not relied on** |
| Settings → General → Releases | **Enable release immutability** before the mirror workflow is ever enabled. The mirror refuses to copy into mutable releases; if this setting is not offered for a private repository on GitHub Free, `mirror-history.yml` stays disabled and the mirror needs another design |
| Repository secrets | None yet |

### Your account (both repositories depend on it)

| Setting | Value |
| --- | --- |
| Two-factor authentication or passkey | On |
| Settings → Billing and licensing → Budgets and alerts | No Actions or Packages budget above $0. If a payment method is on file, create an Actions budget of $0 with **Stop usage when budget limit is reached**. Turn on included-usage alerts (90% and 100%). |

### Local development environment (your laptop)

Node 22 LTS and Git. No Cloudflare login, no Wrangler, no tokens.
`npm test` runs the zero-dependency security suite. The Astro site is added in M1.

## Stage 2 — NOT yet approved: credentials

| Credential | Where | Exact permissions | Expiry | What it can do if misused |
| --- | --- | --- | --- | --- |
| Desk signing key (Ed25519) | Private repo secrets `DESK_SIGNING_KEY`, `DESK_KEY_ID`; public key in `config/desk-signers.json` via pull request | Signs bundle manifests only | Rotate every 6 months; revoke with `revokedAt` | Sign bundles for the next sequence; content rules still apply |
| Checkpoint signing key (Ed25519) | Public `production` environment secret `CHECKPOINT_SIGNING_KEY`, variable `CHECKPOINT_KEY_ID`; public key in `config/checkpoint-signers.json` via pull request | Signs publication checkpoints only | Rotate every 6 months | Acknowledge a bundle; it never leaves the public production environment |
| `observable-news-dispatch` fine-grained token | Private repo secret `PUBLIC_DISPATCH_TOKEN` | Repository: observable-news only. Contents: read and write. Metadata: read. Nothing else (no Actions, no Administration) | 90 days | Create pub-* drafts, trigger publish runs, delete releases (halts publishing, cannot roll back); cannot sign, push to main, alter published releases or run recovery |
| State encryption key (age) | Public `production` environment secret `STATE_AGE_KEY` | Decrypts the open history batch | Rotate if exposed | Deferred: not needed until the history generator exists |

You generate these on your laptop; the values are never shown to Claude.

## Stage 3 — NOT yet approved: automated workflows

| Workflow | Repo | Trigger | Permissions |
| --- | --- | --- | --- |
| `publish.yml` | public | repository_dispatch `content-approved`, manual | workflow `contents: read`; job `contents: write` (attach checkpoint, publish or delete the `pub-*` draft); environment `production` |
| `recover.yml` | public | manual only | job `contents: write`; environment `production`; you type the last good sequence |
| `export.yml` | private | push to main changing `content/approved.json` | `contents: read`; uses `PUBLIC_DISPATCH_TOKEN`, `DESK_SIGNING_KEY` |
| `history.yml` | public | **disabled** (no schedule, `if: false`) | stays off until the batch generator is implemented and tested |
| `mirror-history.yml` | private | **disabled** (no schedule, `if: false`) | stays off with `history.yml` |

Before enabling: replace `PIN_PUBLIC_COMMIT_SHA` with the public repository's first verified commit, and run live tests T-L1 to T-L4.
