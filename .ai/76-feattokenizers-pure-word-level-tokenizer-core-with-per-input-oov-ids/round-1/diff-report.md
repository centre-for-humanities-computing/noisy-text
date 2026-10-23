- Round: 1
- Commits: 8 (6ffcd2c..388d8d3)

## Deviations from the plan

- S3 was split into S3a (normalize) and S3b (segment + tests) because the combined slice landed above its 250-line budget; both halves are independently green.
- No slices were dropped, reordered, or enlarged.

## Known limitations and residual risk

- Decode is a spacing heuristic, not a general detokenizer: digits, `/_@#`, emoji and unspaced neutral punctuation gain spaces; combining marks split from their base; straight quotes are ambiguous.
- OOV ids grow monotonically per tokenizer instance with no eviction.
- The page still uses the static `tok.vocabSize` as the mask sentinel; switching to the effective size is deferred to later #53 slices.
- AC5's HF adapter shape guarantee rests on the compiler and the existing suite, not a dedicated test.

## Not exercised

- `loadHfTokenizer` is not unit-tested because it downloads a model; `npm run check` plus the existing page path cover the `encode` return-shape change.
- No e2e run: this round has no `## Smoke steps` and no user-visible behaviour change.

## Verification

- `npm run test`: 48 files, 575 tests passed.
- Last `slice-check` (S6): check, lint, format and test green; +1/−1 lines.
- Earlier slices: S1 45/60, S2 191/200, S3a 57/250, S3b 208/250, S4 308/400, S5 40/150 — all within budget.
