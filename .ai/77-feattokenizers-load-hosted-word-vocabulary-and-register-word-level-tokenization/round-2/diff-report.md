- Round: 2
- Commits: 12 (411b38e..8474595)

## Deviations from the plan

- The round-2 plan was untracked when `/implement` started; it landed as a setup commit `411b38e` (included in the count above).
- S6 landed at 101 changed lines against an 80-line budget (over the split threshold), so it was split: S6a (`ba80ce5`) has the pending-promise cache and the concurrent-dedupe test, S6b (`3dbf65e`) adds the cache-hit and rejected-retry tests.
- S4 landed at 36 lines against a 30-line budget and also updated the `token-label.ts` comment, which still said "per-input" about the OOV table.
- S3's e2e comment was reworded: the plan said the second edit has two distinct OOV tokens, but the space token makes it three (equal to the table), so the comment explains the cumulative table without claiming a numeric difference.
- S10 landed at 6 lines against a 5-line budget; the wording was compressed to stay inside the 25% tolerance.

## Known limitations and residual risk

- A second concurrent tokenizer caller shares the first caller's `onProgress` callback; the page guards concurrent selects and the worker does not render vocabulary progress.
- The e2e `+3 OOV seen` assertion does not by itself distinguish an instance table from a per-input count (both are 3 for that input); the cumulative contract is pinned by `word.test.ts`.
- Full-graph labels are painted on a canvas and are not DOM-assertable; the regression is the posted-message unit test.
- The Python exporter still has no automated test suite; S7/S8 were verified with synthetic sources only.
- The pinned hosted asset remains `ee6442d` (50k words); no export or upload was performed.

## Not exercised

- IndexedDB under Node: the loader unit test covers only the network miss; the cache hit is covered by the e2e reload test.
- The real hosted 50k asset: e2e routes the request to the 40-word fixture.
- The exporter's authenticated HF upload path: only `--no-upload` was run.
- Canvas painting of OOV labels; only the worker message and label helper are tested.

## Verification

- `npx prettier --check .`: clean.
- `npm run test`: 50 files, 598 tests passed.
- `npm run e2e`: 10/10 passed in 2.7m, including the three word-tokenizer cases.
- Last slice-check: S10 `+3/-3 = 6 lines` against budget 5 (within tolerance); S8 `18` against 15 and S4 `36` against 30 were accepted slightly over.
