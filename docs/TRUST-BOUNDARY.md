# Trust boundary (GitHub Free)

* **Private desk repository.** No enforced branch protection or environments on
  GitHub Free. Every workflow there can read its repository secrets. The trust
  boundary is your GitHub account. Private CI is advisory.
* **Approval proof.** A desk bundle is accepted only if its manifest is signed by
  a key in `config/desk-signers.json` (Ed25519, domain-separated), the bundle hash
  and size match the signed manifest, its sequence is exactly the publication
  head + 1, and it names that head's checkpoint (`basedOn`). A valid SHA-256 alone
  proves nothing.
* **Content proof.** A valid signature does not prove editorial quality. Every
  bundle then passes a closed schema: each story source carries permission
  evidence (basis, rights, evidence id and hash); explainers need references and a
  review; classifications need non-empty, complete evidence and a review; images
  need a licence, attribution and permission evidence; every cross-reference
  must resolve.
* **Enforcement point.** The public repository, under the `protect-main` ruleset
  (empty bypass list) and the `production` environment (main only). The private
  side cannot change the validator or either trust store.
* **Durable anti-replay state.** Each publication is an immutable release
  `pub-NNNNNNNN` carrying the bundle and a checkpoint signed with a key held only
  in the public `production` environment. Runners keep no state; every run reads
  the head from the releases. Used tag names can never be reused, so deleting
  releases cannot reopen a sequence: publishing halts until you record a signed
  skip with the manual `recover` workflow.
* **Dispatch token** (Contents: read and write on the public repository). It can
  create pub-* drafts, trigger runs and delete releases. It cannot sign bundles
  or checkpoints, push to public main, alter published immutable releases or start
  the manual recovery workflow (that needs Actions: write). Worst case: it halts
  publishing (detected, needs recovery), or, when two signed exports exist for the
  same sequence, submits the older one first.
* **Publication history.** Closed 6-hour batches will be immutable releases
  `history-*`. The private mirror copies only batches that are intact and correctly
  chained, never overwrites a mirrored batch, and fails on any divergence.
