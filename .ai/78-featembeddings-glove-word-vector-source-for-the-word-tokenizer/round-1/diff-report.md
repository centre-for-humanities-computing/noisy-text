# Round 1 — GloVe word-vector source for the word tokenizer (#78)

- Round: 1
- Commits: 10 (`ea294ec`..`bd5e3ab`), 22 files changed, +765/−10 lines

## Deviations from the plan

- **S4 split.** `feat(#78): register the GloVe 840B word-vector source` was
  planned as one ≤45-line slice but needed 60 lines, so it was split into S4a
  (registry entry + tests, 34 lines) and S4b (`sourceForTokenizer`, 26 lines).
  Both slices carry their own `Slice:` trailer.
- **S6 effect order.** The plan said to add the "keep `words` when
  `embedding-knn` is selected" effect *after* the existing source→tokenizer
  effect. Effects run in creation order, so placed after, the older effect would
  first reset `words` to the source's tokenizer (GPT-2) and the new effect would
  then no-op. The new effect is placed **before** the older one; the older one
  then no-ops because the source already pairs with `words`. No loop.
- **S7 input and OOV count.** The plan text used `the cat walks zorblax` and
  expected `(+1 OOV seen)`. `cat`/`walks` are not in the 40-word fixture
  vocabulary, so that input would add three OOV ids. The spec uses
  `the quick brown zorblax` (only `zorblax` is a new word) and asserts
  `(+2 OOV seen)` — the extra id is the inter-word space token, which the
  word tokenizer treats as OOV because the static vocabulary contains single
  words only. The spec is `e2e/glove-word-vectors.spec.ts`, with the bundle
  served from `e2e/fixtures/tiny-bundle.ts`; both routes are mocked, so no
  network is used.
- **S3 verification scope.** `scripts/export_word_vectors.py` is 184 lines,
  slightly over its 170-line budget but within the 1.25× split threshold, so it
  was not split. It was verified with `python3 -m py_compile` and `--help`
  (lazy imports keep both working without numpy/torch); the repo has no CI job
  for Python, so the script's streaming/export path is not exercised in CI.

## Known limitations and residual risk

- The hosted GloVe bundle has **not** been uploaded to
  `chcaa/noisy-text-embeddings`, and `HF_DATASET_REVISION` in
  `src/lib/embeddings/loader.ts` is intentionally unchanged. Until the four
  `glove-840b-300d.*` artefacts and a matching `word-vocab-50k.json` are
  published and the revision pinned, selecting the source against production
  will 404.
- OOV ids ($\ge K$) have no matrix row and degrade to the uniform floor over
  $K_{\text{eff}} = K + |\text{OOV table}|$; this is a deliberate $\varepsilon$
  fallback, not a learned embedding for unseen words.
- `vocabSha` verification uses `crypto.subtle`, which requires a secure context
  (HTTPS or localhost). A plain-HTTP deployment would fail verification.
- E2E coverage routes `**/glove-840b-300d.*` and `**/word-vocab-50k.json` to
  in-memory fixtures; the real fetch/IndexedDB path for the GloVe bundle is not
  exercised end to end. The tiny bundle's transform is a no-op and its matrix
  encodes a toy 8-group concept table, so the e2e test validates plumbing and
  id-range safety, not neighbour quality.

## Not exercised

- Upload to the HF dataset repo and revision pinning.
- Fetching the real 300-d, 50k-row GloVe bundle (blocked on hosting).
- Python export script beyond `py_compile`/`--help` (no numpy/torch in CI).

## Verification

- `node scripts/slice-check.mjs` passed for all ten commits (`check`, `lint`,
  `format`, `test`).
- Final `npm run test`: pass.
- Final `npm run e2e`: 11 tests passed in 3.2m, including
  `e2e/glove-word-vectors.spec.ts` (GloVe source auto-selected, word tokenizer
  retained, `(+2 OOV seen)`, all rendered ids in `0..41`, no `NaN`/`undefined`,
  no page/console errors).
