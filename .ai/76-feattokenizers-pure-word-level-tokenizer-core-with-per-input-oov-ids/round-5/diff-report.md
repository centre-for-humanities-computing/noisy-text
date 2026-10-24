- Round: 5
- Commits: 1 (4b50484..4b50484)

## Deviations from the plan

- None. The single slice landed under budget; no split was needed.

## Known limitations and residual risk

- The round-trip contract remains a documented heuristic: straight quotes are
  now excluded from both adjacent-mark failure clauses, but other punctuation
  pairs can still gain or lose a space on unspaced input (unchanged).
- The contract text still lives in two unsynchronized copies (`README.md` and
  the `decode` doc comment); they are identical today with no test guarding
  the duplication.
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
- `slice-check` (S1): check, lint, format and test passed; `+20/-17 = 37`
  lines against a budget of 40.
- Manual decode audit of all eleven documented/claim-adjacent forms (`’tis`,
  `'tis`, `"tis`, `word’`, `word'`, `a"`, `a'`, `word-`, `-tis`, `a,b`, `a(b`):
  every output matches the new wording.
- `npx prettier --check .`: clean (part of `slice-check`).
