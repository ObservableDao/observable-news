# Push checklist (Stage 1)

Everything in both repositories is safe to push: no secrets, empty trust stores,
and the only active workflow in each repository is `ci.yml` (no secrets, read-only token).
Proposed workflows sit outside `.github/workflows` and cannot run.

1. Run `git ls-remote https://github.com/actions/setup-node refs/tags/v6.0.0` and
   check it prints `2028fbc5c25fe9cf00d9f06a71cc4710d4507903` (test P-L1). If it does
   not, stop: do not push until the pin is corrected.
2. Create `ObservableDao/observable-news` (public) with no README, then push `main`.
   Public CI runs once (public-repository minutes are free).
3. Apply the Stage 1 settings in `SETTINGS-FOR-APPROVAL.md`, including release
   immutability, then import both rulesets.
4. Create `ObservableDao/observable-news-desk` (private) and push `main`. Its CI does
   not run on push.
5. Run live tests T-L2 to T-L4, D-L1, D-L2, S-L1, S-L2 and S-L3 with a throwaway release.
