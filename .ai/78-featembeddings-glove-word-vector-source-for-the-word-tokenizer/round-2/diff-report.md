# Round 2 — GloVe word-vector source (#78)

- Round: 2
- Commits: 6 (`0ba7703`..`85b32de`), 7 files changed, +62/−20 lines

## Deviations from the plan

- **S5 dropped.** The plan asked to mark `glove-840b-300d` as "authored but
  not yet uploaded" and to warn that the pinned revision 404s. Between round 1
  and this round, commit `03d33f1` uploaded the bundle and bumped
  `HF_DATASET_REVISION` to `6fecdd0…`; the four artefacts are present at that
  revision and the hosted `vocabSha` (`168a96…`) equals the SHA-256 of the
  hosted `word-vocab-50k.json` words joined by `\n`, so the bundle is live and
  aligned. `src/lib/embeddings/README.md` already described GloVe as hosted, so
  there was no wording left to change; finding R1-N3 is closed by the upload.
  Confirmed with the human before implementing.
- **S0 added (unplanned).** `03d33f1` dropped the semicolon on
  `HF_DATASET_REVISION`, so the branch failed CI's `prettier --check` and
  `slice-check`'s `format` step would have staged that unrelated line into S1.
  It is its own one-line mechanical commit (`chore(#78)`, `Slice: S0/5`).
- **S4 split into S4a/S4b.** The combined docs change measured 14 lines
  against a ≤10 budget (`slice-check` exited 2), so it was split by file:
  S4a the README bundle-format bullet, S4b the `vocabSha` doc comment.
- **S1 also corrects the round-1 report**, as planned: the "11 tests passed"
  claim is replaced with the actual 10/11 result and the failing
  `strategy absorbing renders and scrubs`.
- **S2 landed at 31 lines** against its 30-line budget (within the 1.25×
  threshold): the duplicate warning block is longer than estimated.

## Known limitations and residual risk

- S2 warns on stderr instead of raising, as the plan requires, because the real
  `glove.840B.300d.txt` repeats tokens. A duplicated word with a *different*
  vector silently keeps its first occurrence; a corrupt source is visible only
  in the warning, not in the exit status.
- The round-1 diff report still carries its "bundle has not been uploaded"
  limitation bullet. It is superseded by `03d33f1` but was left untouched —
  round 2 only corrects the e2e claim (planned S1 scope).
- The `[MASK]` assertion in the smoke test is gated on `id === 'absorbing'`;
  it would not notice another strategy silently rendering mask sentinels.
- `word-vocab-50k.json` alignment is verified out of band (hash computed from
  the hosted file during this round); nothing in CI re-checks the hosted
  artefacts against `vocabSha`.

## Not exercised

- S2 has no committed test: the repo has no Python harness and no `test_*.py`.
  Instead `load_glove_rows` was exercised with a duplicate file, an
  all-duplicate file and a file missing a word, using numpy installed in a
  throwaway venv under `/tmp` (the repo has no numpy and CI does not run
  Python).
- The real fetch of the hosted 300-d bundle in a browser: e2e still routes
  `**/glove-840b-300d.*` and `**/word-vocab-50k.json` to fixtures, so upload
  and download remain untested end to end.
- The exporter's full streaming/quantise/upload path beyond `py_compile` and
  `--help`.

## Verification

- Per slice `node scripts/slice-check.mjs --budget <budget>`: green for all five
  commits (`check`, `lint`, `format`, `test`); last run S4b `+4/−3 = 7 lines in
  1 files; budget 10: within budget`.
- S1 also ran `npx playwright test e2e/smoke.spec.ts -g absorbing` (1 passed).
- Final `npm run test`: 51 files, 616 tests passed.
- Final `npm run e2e`: 11 passed in 3.5m, including
  `strategy absorbing renders and scrubs` and `e2e/glove-word-vectors.spec.ts`.
