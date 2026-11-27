# Trust boundary (GitHub Free)

* **Private desk repository.** No enforced branch protection or environments on
  GitHub Free. Every workflow there can read its repository secrets. The trust
  boundary is your GitHub account. Private CI is advisory.
* **Approval proof.** A desk bundle is accepted only if its manifest is signed by
  a key in `config/desk-signers.json` (Ed25519, domain-separated), the bundle
  hash and size match the signed manifest, and its sequence number is higher
  than the last accepted one. A valid SHA-256 alone proves nothing.
* **What a valid signature means.** The bundle was produced by a holder of the
  desk signing key — normally the export workflow on the private `main` branch.
  It does not prove editorial quality; the public content rules run afterwards
  on every bundle.
* **Enforcement point.** The public repository, under the `protect-main`
  ruleset (empty bypass list) and the `production` environment (main only).
  The private side cannot change the validator or the trust store.
* **Dispatch token.** Can trigger runs and upload assets, but cannot sign,
  cannot push code to public main, and cannot alter immutable history releases.
* **Publication history.** Closed 6-hour batches are published as immutable
  releases (assets cannot be modified or deleted; tags cannot be moved). A whole
  release can still be deleted by an administrator, and its tag name cannot be
  reused; deletions are detected by the hash chain and restored from the
  private mirror.
