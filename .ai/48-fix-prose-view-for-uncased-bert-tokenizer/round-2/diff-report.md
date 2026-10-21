- Round: 2
- Commits: 7 (2e6ea9a..f9fe71d)

## Deviations from the plan

- S5 was split into S5a (DESIGN.md §10.2) and S5b (docs/libraries.md,
  tokenizers README) because the combined diff (55 lines) exceeded the
  40-line budget's 25% tolerance.
- S3: adding whitespace pieces to the differential generator required a
  matching no-separator rule in `decodeStub` and `naiveSpans` (a space
  piece matches at the cursor and consumes no separator); without it the
  naive reference disagreed with the implementation.
- S4: the plan's single 10% scrub masked nothing at the default schedule
  (≈0.21% of tokens eligible per step at t=30/300), so the test scrubs
  forward in 5% increments until the prose actually changes, then asserts.
  The second `noise-button` click in the plan does not exist in explore
  mode; selecting `strategy-absorbing` triggers the recompute on its own.
- S4: the input fill was moved after selecting the tokenizer card —
  filling before Svelte hydration finished was silently overwritten by
  the app's default text.

## Known limitations and residual risk

- GPT-2 non-ASCII tokens decode to U+FFFD in isolation and remain
  unhighlighted (documented in S2, not fixed).
- All-masked prose still renders an empty paragraph (pre-existing,
  out of scope).
- The e2e fixtures depend on the pinned `Xenova/bert-base-uncased` and
  `Xenova/gpt2` aliases; a vocab change upstream would need fixture updates.
- The plan commit for this round (`.ai/.../round-2/plan.md`) is untracked
  in the working tree; it is not part of these slices.

## Not exercised

- Real tokenizer decoding in unit tests: the unit tests use decoder stubs;
  the real WordPiece/GPT-2 decode paths are exercised by the e2e run
  against the live transformers.js tokenizers.

## Verification

- Final `npm run test`: 45 files, 529 tests, all passed.
- `npm run e2e`: 6 tests, 6 passed (4 smoke + 2 new prose-span tests;
  run with network access for tokenizer weights).
- Last `slice-check`: S6 budget 20 — check/lint/format/test ok.
