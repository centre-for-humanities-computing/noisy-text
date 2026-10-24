- Round: 3
- Commits: 1 (2ea7cb5..2ea7cb5)

## Deviations from the plan

- None.

## Known limitations and residual risk

- The round-trip contract is still a documented heuristic; this round narrows
  the joiner clause and pins the passing configurations, it does not make the
  full condition exhaustive.

## Not exercised

- No network-backed HF tokenizer test was added or run; this round does not
  change `hf-tokenizer.ts`.
- No e2e run: the plan has no `## Smoke steps` and no user-visible behaviour
  changed.

## Verification

- Final `npm run test`: 48 files, 578 tests passed.
- `npx prettier --check .`: all matched files formatted (run by `slice-check`).
- `slice-check` (S1): check, lint, format and test passed; `+10/-5 = 15` lines
  against a budget of 30.
