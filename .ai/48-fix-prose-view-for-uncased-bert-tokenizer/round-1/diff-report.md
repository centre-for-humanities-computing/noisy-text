# Round 1 diff report

- Round: 1
- Commits: 6 (4070227..ad6059b)

## Deviations from the plan

- S1 was split into three commits to stay within slice budgets: S1a
  (`alignTokenPieces` + hand-picked tests, 149 lines), S1b (`allTokenCharSpans`
  rewrite + call site + tests, 114 lines), S1c (differential test vs naive
  reference, 112 lines). Same scope as planned S1.
- S2 measured +92/-3 = 95 lines against budget 85; slice-check reported it
  "slightly over" but exited 0 and it was committed as planned.
- S3 measured +14/-165 = 179 lines against budget 170 (human-waived over 150);
  slice-check exited 0 and it was committed as planned.

## Known limitations and residual risk

- Pre-existing, not from this round: with the absorbing strategy at the final
  timestep every token is a mask, so the prose view renders an empty paragraph
  (`decodedText` returns '' when no non-mask tokens remain). The
  `strategy absorbing renders and scrubs` smoke test fails on this at frac=1;
  the failure reproduces verbatim at the pre-round base commit (4070227), so
  it is unrelated to this issue. Candidate follow-up issue: render a
  placeholder when the prose view is fully masked.
- `alignTokenPieces` aligns by greedy cursor matching; pathological decoders
  whose pieces do not appear in order in the decoded text (e.g. heavy
  `clean_up_tokenization_spaces` rewrites) fall back to an empty span at the
  cursor. The differential test covers WordPiece-style decoding only.

## Not exercised

- Real BERT/GPT-2 tokenizers under unit tests (vitest has no tokenizer
  weights); covered instead by the e2e smoke test looping
  `['bert-base-uncased', 'gpt2']` against live tokenizer loads.
- `clean_up_tokenization_spaces` behavior of the real `decode` — the stubs
  disable it; the e2e test exercises the real decoder end-to-end.

## Verification

- Final `npm run test`: 45 files, 524 tests, all passed.
- `npm run e2e`: 5 passed, 1 failed (`strategy absorbing renders and scrubs` —
  pre-existing full-mask prose failure, reproduced at 4070227). The new
  `fix-prose-view-for-uncased-bert-tokenizer.spec.ts` test passes for both
  `bert-base-uncased` and `gpt2`.
- Last `slice-check --budget 170` (S3): ok check/lint/format/test,
  +14/-165 = 179 lines, "slightly over" budget, exit 0.
