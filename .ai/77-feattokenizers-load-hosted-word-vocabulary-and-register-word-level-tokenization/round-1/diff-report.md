- Round: 1
- Commits: 9 (48b268f..399777e)

## Deviations from the plan

- S1 landed at 141 changed lines against a 120-line budget (17.5% over); all checks passed.
- S7 landed at 195 changed lines against a 190-line budget (2.6% over); all checks passed.
- S4 used `encoded.vocabSize` from the slice text rather than the smoke-step phrasing `Vocab: 40`; the two-OOV fixture therefore shows `Vocab: 42 (+2 OOV)`.
- S8 also documented the `vocab` IndexedDB store and `VITE_WORD_VOCAB_BASE_URL`, and added `tokenizerId` alongside `vocabSize` in the engine cache key, to match the shipped code.

## Known limitations and residual risk

- The production `HF_DATASET_REVISION` is still `REPLACE_WITH_UPLOAD_SHA`; the real 50k GloVe asset must be exported and uploaded before the hosted path serves data. E2E uses a 40-word fixture.
- The page and worker can both fetch the vocabulary before the page's IndexedDB write lands; both paths are idempotent, but the race is not instrumented.
- `word-vocab-loader` reports a null progress fraction when the response has no `Content-Length`; the hosted `resolve` endpoint does send it, but other bases may not.
- The word tokenizer's documented round-trip limits (digits, `/_@#`, emoji, unspaced neutral punctuation, combining marks) remain.
- Bumping the shared HF revision invalidates the embedding-matrix caches as well; the runbook calls this out.

## Not exercised

- IndexedDB under Node: `word-vocab-loader.test.ts` stubs fetch and exercises the network miss path; the cache hit is covered only by the e2e reload test.
- The real hosted 50k asset: no upload was performed; e2e uses `e2e/fixtures/word-vocab/word-vocab-50k.json`.
- The export script's authenticated HF upload path: only `py_compile`, `--help`, and a synthetic `--no-upload` run were exercised.
- The worker/page vocabulary-fetch race and the 50k load/encode cost were not benchmarked.

## Verification

- `npm run test`: 50 files, 592 tests passed.
- `npm run e2e`: 10/10 passed in 2.7m (including the three word-tokenizer cases).
- Last slice-checks: S9 `+1/-1 = 2 lines` within budget 5; S8 `+44/-13 = 57 lines` within budget 60; S7 accepted slightly over its 190-line budget.
