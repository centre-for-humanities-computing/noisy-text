- Round: 4
- Commits: 2 (ac87399..18a9ed4)

## Deviations from the plan

- None. Both slices landed in plan order and under budget; no split was needed.

## Known limitations and residual risk

- The round-trip contract remains a documented heuristic: it now matches the
  three joiners exactly, but other punctuation pairs can still gain or lose a
  space if the input is unspaced (unchanged by this round).
- The contract text lives in two places (`README.md` and the `decode` doc
  comment) with no test asserting they agree; they are identical today and a
  future edit could desynchronize them.
- The review's standing "missing tests" list (`parseWordVocab` rank
  differential, AC4 whole-string pin, negative-id decode, `version: Infinity`,
  whitespace-only encode, U+10400, `a ,b`) is deliberately untouched, as it is
  outside the open-findings line.

## Not exercised

- No e2e run: the plan has no `## Smoke steps` and no user-visible behaviour
  changed (the word tokenizer is still not registered).
- No network-backed HF tokenizer test was run; `hf-tokenizer.ts` is unchanged.

## Verification

- Final `npm run test`: 48 files, 578 tests passed.
- `slice-check` (S1): check, lint, format and test passed; `+3/-1 = 4` lines
  against a budget of 20.
- `slice-check` (S2): check, lint, format and test passed; `+15/-10 = 25` lines
  against a budget of 60.
- Manual decode audit of all eleven documented forms (`’tis`, `'tis`, `word’`,
  `word'`, `word-`, `-tis`, `-tis-`, `Don-t`, `a ’ b`, `a,b`, `a(b`): every
  output matches the new wording.
- `npx prettier --check .`: clean (part of `slice-check`).
