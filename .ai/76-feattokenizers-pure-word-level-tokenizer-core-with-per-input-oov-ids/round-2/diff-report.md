- Round: 2
- Commits: 6 (4b2b261..c8a198d)

## Deviations from the plan

- S2 (R1-N2) was split into S2a/S2b: the full rejection-reason conversion was
  68 changed lines against a 40-line budget (more than 1.25×), so the shape and
  metadata cases landed first and the word/rank cases second.
- The round now has 6 slices; S1's trailer was amended from `S1/5` to `S1/6`
  before any later commit was pushed.

## Known limitations and residual risk

- The round-trip contract is still a documented heuristic; S1 only makes the
  documentation and its regression test agree with the existing behaviour.
- Punctuation spacing is pinned by literal cases, but only in the positions the
  decode rule is designed for (closing after a word, opening before a word).

## Not exercised

- No network-backed HF tokenizer test was added or run; this round does not
  change `hf-tokenizer.ts`.
- No e2e run: the plan has no `## Smoke steps` and no user-visible behaviour
  changed.

## Verification

- Final `npm run test`: 48 files, 578 tests passed.
- `npx prettier --check .`: all matched files formatted.
- Last `slice-check` (S5): check, lint, format and test passed; `+8/-0 = 8`
  lines against a budget of 25.
- Per-slice `slice-check` results: S1 32/45, S2a 33/40, S2b 41/40 (within 1.25×),
  S3 11/25, S4 39/45, S5 8/25.
