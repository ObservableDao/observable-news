# M0 settings for approval

Nothing in this file has been applied. Each section needs your explicit approval.
No R2, Cloudflare Access, Workers, paid services or changes to Daymark or
Observable Dao are involved.

## Stage 1 — approved: repositories, public rules, local environment

### ObservableDao/observable-news (public)

| Setting | Value |
| --- | --- |
| Visibility | Public |
| Settings → General → Releases | **Enable release immutability** (applies to future releases only) |
| Settings → Actions → General → Actions permissions | Allow ObservableDao actions and select non-ObservableDao actions: only `actions/checkout`, pinned to a full commit SHA |
| Settings → Actions → General → Fork pull request workflows | Require approval for all external contributors |
| Settings → Actions → General → Workflow permissions | Read repository contents and packages permissions; "Allow GitHub Actions to create and approve pull requests" **off** |
| Settings → Rules → Rulesets | Import `config/rulesets/protect-main.json` and `config/rulesets/protect-history-tags.json`, bypass list empty |
| Settings → Code security | Secret scanning and push protection **on**; Dependabot alerts **on** |
| Settings → Environments | `production`: deployment branches = `main` only; no secrets yet |
| Collaborators | None |

### ObservableDao/observable-news-desk (private, GitHub Free)

| Setting | Value |
| --- | --- |
| Visibility | Private |
| Collaborators | None (you only) |
| Settings → Actions → General → Workflow permissions | Read repository contents; PR creation/approval **off** |
| Fork pull request workflows (private) | **Off** (default) |
| Rulesets / branch protection / environments | **Not available on GitHub Free for private repositories — not relied on** |
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
| Desk signing key (Ed25519) | Private repo secrets `DESK_SIGNING_KEY`, `DESK_KEY_ID`; public key in `config/desk-signers.json` via pull request | Signs bundle manifests only | Rotate every 6 months; revoke by setting `revokedAt` | Sign bundles that pass authenticity — content rules still apply |
| `observable-news-dispatch` fine-grained token | Private repo secret `PUBLIC_DISPATCH_TOKEN` | Repository: observable-news only. Contents: read and write. Metadata: read. | 90 days | Start runs; upload/delete mutable release assets; cannot push code (ruleset); cannot alter immutable history releases; cannot sign bundles |
| State encryption key (age) | Public `production` environment secret `STATE_AGE_KEY` | Decrypts state artifacts | Rotate if exposed | Read encrypted working state |

Generated on your laptop by you; values never shown to Claude.

## Stage 3 — NOT yet approved: automated workflows

| Workflow | Repo | Trigger | Permissions |
| --- | --- | --- | --- |
| `publish.yml` | public | repository_dispatch `content-approved`, manual | `contents: read`; environment `production` |
| `history.yml` | public | 00:17, 06:17, 12:17, 18:17 UTC | workflow `contents: read`; job `contents: write` (create draft, attach, publish) |
| `export.yml` | private | push to main | `contents: read`; uses `PUBLIC_DISPATCH_TOKEN`, `DESK_SIGNING_KEY` |
| `mirror-history.yml` | private | daily 03:41 London | job `contents: write` in the private repo only |

Before enabling: pin every action to a full commit SHA (`check-workflows.mjs` fails otherwise) and
pin the public validator commit in the private workflows.
