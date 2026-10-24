- Round: 6
- Commits: 2 (66363f0..f97afd0)

## Deviations from the plan

- None. S1 landed at +14/-1 (15 lines, budget 25) and S2 at +10/-8 (18 lines,
  budget 40); no split was needed.

## Known limitations and residual risk

- The contract text still lives in two unsynchronized copies (`README.md` and
  the `decode` doc comment); they agree word-for-word on the failure clause
  after S2, but no test guards the duplication.
- The new clause is derived from `needsSpace` plus `WORD_PATTERN` absorption
  rather than enumerated per character, but it is still prose: a future change
  to either helper can invalidate it silently. S1 pins the four forms this
  round discusses (`’b`, `a“b` fail; `a’b`, `a"b` pass).
- The review's standing "missing tests" list (`parseWordVocab` rank
  differential, AC4 whole-string pin, negative-id decode, `version: Infinity`,
  whitespace-only encode, U+10400, `a ,b`) remains untouched, as it is outside
  the open-findings line.

## Not exercised

- No e2e run: the plan has no `## Smoke steps` and no user-visible behaviour
  changed (the word tokenizer is still not registered).
- No network-backed HF tokenizer test was run; `hf-tokenizer.ts` is unchanged.

## Verification

- Final `npm run test`: 48 files, 578 tests passed.
- `slice-check` (S1): check, lint, format and test passed; `+14/-1 = 15` lines
  against a budget of 25.
- `slice-check` (S2): check, lint, format and test passed; `+10/-8 = 18` lines
  against a budget of 40.
- Manual decode audit of the documented forms: `a,b` → `a, b`, `’b` → `’ b`,
  `a(b` → `a (b`, `a“b` → `a “b`, `’tis` → `’ tis`, `-tis` → `- tis`,
  `word-` → `word -` all fail the round trip as the text says, while `a’b`,
  `a"b`, `Don’t`, `word’`, `a ’ b`, `'tis`, `word'`, `"tis`, `a"` round-trip.
- `npx prettier --check .`: clean (part of `slice-check`).
