- Round: 1
- Addresses: none (initial plan)
- Slices: 9
- Estimated size: ~840 changed lines

## Goal and acceptance criteria

Add GloVe 840B 300d as a third embedding source whose rows are ordered
exactly like the hosted 50k word vocabulary, so `embedding-knn` works with the
`words` tokenizer out of the box. Word ids are $0 \ldots K-1$ with
$K = 50{,}000$; ids $\geq K$ (per-input OOV words) have no matrix row and must
degrade to the kernel's uniform floor over $K_{\text{eff}} = K + |\text{OOV}|$
instead of reading memory or producing NaN.

- AC1: Selecting `embedding-knn` while the word tokenizer is active keeps the
  `words` tokenizer and selects the GloVe word source; word tokens scrub
  without any extra configuration.
- AC2: Substituted words come from the 50k static vocabulary; an OOV word
  changes only through the ergodicity floor $\varepsilon$ or the absorbing
  mask, never through a neighbour list.
- AC3: Ids $\geq K$ never read a matrix row (seeded randomized id-sweep test),
  and `getLocalDistribution(oovId)` returns a valid distribution over
  $K_{\text{eff}}$.
- AC4: Meta/vocabulary alignment is enforced through `vocabSha`, and the
  worker's source/tokenizer pairing and vocab-size checks pass for the GloVe
  source.
- AC5: `npm run check`, `npm run lint`, `npx prettier --check .`,
  `npm run test`, and `npm run e2e` pass.

## Slices

### S1 — Out-of-range token ids yield an empty neighbour table

- Kind: behavioral
- Budget: ≤180 changed lines
- Files: `src/lib/embeddings/knn-index.ts` (modify) — no new exports.
  `topM(token: number): TopMTable` guards first:
  `if (!Number.isInteger(token) || token < 0 || token >= K)` returns a
  memoized `{ ids: new Int32Array(0), dists: new Float32Array(0) }` stored in
  `_topM`, so repeated OOV lookups are free. `_rowOf(token)` throws a
  `RangeError` naming the token (last-resort invariant; every public entry
  point guards). `distance(a, b): number` returns `Number.POSITIVE_INFINITY`
  when either id is out of range (never NaN). Add a private `_inRange(id)`.
  Module doc: for $x \geq K$ the row does not exist, so the kernel row is
  empty and `token-kernel.ts` turns it into $1/K_{\text{eff}}$.
  `src/lib/embeddings/embedding-distance-model.ts` (modify) —
  `candidates(token, _radius)` returns immediately when
  `token < 0 || token >= this.K`.
- Tests: `src/lib/embeddings/knn-index.test.ts` — extend with a
  `describe('ids without a row')`: a seeded sweep
  (`seedrandom('oov-sweep\0')`, 200 random integer ids in
  $[K, K+1000)$) asserting `topM` returns zero-length ids/dists, is memoized
  (same object reference), and throws nothing; `distance(oov, 3)` and
  `distance(3, oov)` are `Infinity`, not NaN. Add a seeded randomized
  differential case for in-range ids: small line matrix ($K = 24$, $d = 4$,
  preprocess `'none'`), 100 random ids, compare `topM` ids/dists against a
  naive brute-force reference that dequantizes rows with `dequantizeRow` and
  sorts all $j \neq i$ by `metricDistance`.
  `src/lib/embeddings/embedding-distance-model.test.ts` — `candidates(K)` and
  `candidates(-1)` yield nothing; an in-range token still yields its rows.
  `src/lib/strategies/embedding-knn.test.ts` — build a real
  `EmbeddingKnnIndex` (line-matrix fixture) + `EmbeddingDistanceModel` +
  `NeighborhoodProvider`, create the strategy with
  `vocabSize = K + 1`, and assert `getLocalDistribution(K, 1)` has length
  `K + 1`, sums to 1, and equals $1/(K+1)$ everywhere.
- Covers: AC2, AC3
- Commit: `fix(#78): treat ids without an embedding row as empty neighbours`
- Reviewer note: Confirm no code path can index `codes`/`scales` past $K$,
  and that the empty row still reaches the uniform floor rather than a
  zero-mass vector.

### S2 — Enforce vocabulary alignment with `vocabSha`

- Kind: behavioral
- Budget: ≤120 changed lines
- Files: `src/lib/embeddings/types.ts` (modify) — add optional
  `vocabSha?: string` to `EmbeddingMeta` (doc: lowercase SHA-256 hex of the
  ordered vocabulary words joined by `\n` and UTF-8 encoded; present only for
  word-vocabulary sources). `src/lib/embeddings/vocab-sha.ts` (create) —
  `vocabCanonicalText(words: readonly string[]): string` (join `'\n'`),
  `wordVocabSha(words: readonly string[]): Promise<string>` (WebCrypto
  `crypto.subtle.digest('SHA-256', ...)`, hex), and
  `verifyVocabSha(meta: Pick<EmbeddingMeta, 'source' | 'vocabSha'>, words: readonly string[]): Promise<void>`
  (no-op when `vocabSha` is undefined; otherwise throw
  `Embedding vocab SHA mismatch for "<source>": expected <a>, got <b>`).
  `src/lib/workers/trajectory.worker.ts` (modify) — after the existing
  vocab-size check (`:187-191`), `await verifyVocabSha(meta, strings)`.
  Import directly from `../embeddings/vocab-sha.js` (no barrel change).
- Tests: `src/lib/embeddings/vocab-sha.test.ts` — `wordVocabSha(['the','a'])`
  equals
  `87b787d3d13453c5ad6b9e993b23b16ab8ce1303fa453ccae6d5cd0a3a7d449c`
  (cross-checked against Python `hashlib`); `verifyVocabSha` resolves on a
  match, rejects with a message naming source and both hashes on a mismatch,
  and is a no-op when `vocabSha` is absent.
- Covers: AC4
- Commit: `feat(#78): enforce vocabulary alignment with vocabSha`
- Reviewer note: Confirm the canonical text is identical in the Python
  exporter (S3) and that gpt2/bert bundles without `vocabSha` are unaffected.

### S3 — Export a vocab-aligned GloVe bundle

- Kind: behavioral
- Budget: ≤170 changed lines
- Files: `scripts/export_word_vectors.py` (create) — imports
  `compute_transform`, `quantize_per_row`, `N_PCS` from
  `export_embeddings`. Flags: `--glove-file` (local `glove.840B.300d.txt`),
  `--vocab` (local `word-vocab-50k.json`), `--out`, `--repo`, `--revision`.
  Steps: parse the vocab JSON, require `ranks` to be a permutation of
  $0 \ldots n-1$ and `n == 50000`; order words by rank; stream the GloVe text
  file (first field = token, rest = 300 floats) keeping only vocabulary words;
  fail with the first ten missing words if any vocab word has no vector, and
  on any vector whose length is not 300; build $K \times 300$ float32 rows in
  vocab order; `vocabSha = hashlib.sha256("\n".join(ordered).encode()).hexdigest()`;
  then write `<out>/glove-840b-300d.{int8.bin,scales.f32.bin,transform.f32.bin,meta.json}`
  with meta `{ source: 'glove-840b-300d', model: 'glove.840B.300d',
  vocabSize: 50000, dim: 300, dtype: 'int8', quant: 'per-row-symmetric',
  nPcs: 32, vocabSha }`; optional `--repo` upload mirrors
  `export_embeddings.py` and prints the resulting commit sha.
- Tests: none (offline I/O script, not run by CI). Verify with
  `python3 -m py_compile scripts/export_word_vectors.py` and
  `python3 scripts/export_word_vectors.py --help`.
- Covers: AC4
- Commit: `feat(#78): export a vocab-aligned GloVe word-vector bundle`
- Reviewer note: Confirm rows are emitted strictly in vocab-rank order, that
  a vocabulary/vector mismatch fails loudly, and that `vocabSha` matches S2's
  canonical text. Note: importing `export_embeddings` pulls in `torch`, which
  the existing script already requires.

### S4 — Register the GloVe 840B source and its tokenizer mapping

- Kind: behavioral
- Budget: ≤45 changed lines
- Files: `src/lib/embeddings/types.ts` (modify) — extend
  `EmbeddingSourceId` with `'glove-840b-300d'`.
  `src/lib/embeddings/sources.ts` (modify) — add the `glove-840b-300d` entry
  (`label: 'GloVe 840B (300d)'`, `plainName: 'GloVe words'`,
  `description: 'GloVe 840B 300d static word vectors aligned to the 50k word
  vocabulary.'`, `gloss: 'Word meaning from GloVe vectors; pairs with the word
  tokenizer.'`, tooltip text, `tokenizerId: 'words'`, `dim: 300`,
  `vocabSize: 50_000`, `fileName: 'glove-840b-300d'`). Add
  `sourceForTokenizer(tokenizerId: string): EmbeddingSourceId | null` that
  scans `EMBEDDING_SOURCES` and returns the first entry whose `tokenizerId`
  matches, else `null`.
- Tests: `src/lib/embeddings/sources.test.ts` — update the key-list assertion
  to `['bert-base-uncased', 'gpt2', 'glove-840b-300d']`; assert the GloVe
  entry's `tokenizerId`/`dim`/`vocabSize`/`fileName`; assert
  `sourceForTokenizer('words') === 'glove-840b-300d'`,
  `'gpt2' → 'gpt2'`, `'bert-base-uncased' → 'bert-base-uncased'`,
  `'nope' → null`.
- Covers: AC1, AC4
- Commit: `feat(#78): register the GloVe 840B word-vector source`
- Reviewer note: Confirm the id/`fileName`/`vocabSize` triple matches the
  exported artefact names and the hosted vocabulary's $K$.

### S5 — Classify word-vocabulary tokens as word-initial

- Kind: behavioral
- Budget: ≤70 changed lines
- Files: `src/lib/strategies/embedding-filter.ts` (modify) — in the
  non-special branch add `else if (tokenizerId === 'words') {
  mask |= TOKEN_FLAG.WORD_INITIAL; }` between the GPT-2 and BERT branches.
  Doc: the static word vocabulary stores whole words only, punctuation is
  never indexed, so every static token is word-initial; OOV ids are outside
  the matrix and never appear in `tokens`.
- Tests: `src/lib/strategies/embedding-filter.test.ts` — for `'words'`,
  `['the', 'cat', '##x']` are all `WORD_INITIAL` and none `CONTINUATION`;
  `['', 'unused1', '<0x4F>']` keep their special/unused/byte-fallback
  bits; the `word-initial` predicate accepts every plain word and rejects the
  special rows.
- Covers: AC2
- Commit: `feat(#78): classify word-vocabulary tokens as word-initial`
- Reviewer note: Confirm GPT-2/BERT masks are unchanged and that a word like
  `##x` (legal in a word vocab) is not treated as a continuation.

### S6 — Keep the word tokenizer when `embedding-knn` is selected

- Kind: behavioral
- Budget: ≤35 changed lines
- Files: `src/routes/+page.svelte` (modify) — add a second `$effect` after the
  existing source→tokenizer effect (`:424-430`): when
  `strategyStore.currentId === 'embedding-knn'` and
  `tokenizerStore.currentId === 'words'`, set
  `embeddingStore.sourceId = sourceForTokenizer('words')!` when it differs.
  Import `sourceForTokenizer` from `$lib/embeddings/sources.js`. Comment that
  the older source→tokenizer direction still wins for gpt2/bert, so manual
  source selection keeps working.
  `src/lib/components/EmbeddingSourcePicker.svelte` (modify) — pass
  `testIdPrefix="embedding-source"` to `CardPicker` (yields
  `data-testid="embedding-source-glove-840b-300d"`).
- Tests: none (Svelte effect wiring; proven by S7's e2e).
- Covers: AC1
- Commit: `fix(#78): keep the word tokenizer when embedding-knn is selected`
- Reviewer note: Convince yourself the two effects cannot loop (the new one
  writes the source whose tokenizer is already `words`, so the old effect
  no-ops) and that selecting GPT-2/BERT sources still changes the tokenizer.

### S7 — End-to-end coverage with a synthesized tiny GloVe bundle

- Kind: behavioral
- Budget: ≤240 changed lines
- Files: `e2e/fixtures/tiny-bundle.ts` (create) — exports
  `installTinyGloveBundle(page: Page): Promise<{ words: string[] }>`.
  Read `e2e/fixtures/word-vocab/word-vocab-50k.json`, order by `ranks`
  (40 words), compute `sha256(words.join('\n'))` with `node:crypto`. Build
  $40 \times 300$ int8 codes from a literal concept table: 8 groups of 5
  consecutive words, word in group $g$ gets $+1$ in dimension $g$ and $0$
  elsewhere, `scales = 1/127`, so codes are $\pm127$ and cosine distance is 0
  within a group and 1 across groups. Transform blob: zero mean (300), zero
  pcs ($300 \times 32$), zero eigenvalues (32), identity whitening
  ($300 \times 300$). Meta:
  `{ source: 'glove-840b-300d', model: 'glove.840B.300d', vocabSize: 40,
  dim: 300, dtype: 'int8', quant: 'per-row-symmetric', nPcs: 32, vocabSha }`.
  Register `page.route('**/glove-840b-300d.meta.json' | '.int8.bin' |
  '.scales.f32.bin' | '.transform.f32.bin')` and
  `'**/word-vocab-50k.json'` (the latter serving the existing fixture with
  `contentType: 'application/json'`).
  `e2e/glove-word-vectors.spec.ts` (create) — one test, `TIMEOUT = 120_000`:
  fill `the cat walks zorblax` before choosing the tokenizer, select
  `tokenizer-words`, select `strategy-embedding-knn`, assert the word
  tokenizer and `embedding-source-glove-840b-300d` stay `aria-checked="true"`
  and `embedding-source-gpt2` is not; click `noise-button`, wait for
  `app-status` `data-trajectory-status="ready"` and the `(+1 OOV seen)`
  counter; set `time-slider` to 0 and assert `prose-text` is the input; set it
  to the max value, switch to the Tokens view, and assert every visible
  `[title^="id: "]` id is an integer in $0 \ldots 40$ and no cell contains
  `NaN`/`undefined`; collect `pageerror`/console-error and assert empty.
- Tests: the spec itself.
- Covers: AC1, AC2, AC4, AC5
- Commit: `test(#78): cover embedding-knn with word tokens end to end`
- Reviewer note: Confirm the fixture's meta/vocab sizes agree with the 40-word
  fixture (the worker rejects mismatches), the sha is computed over rank order,
  and no assertion depends on a specific sampled word.

### S8 — Document the GloVe source

- Kind: mechanical
- Budget: ≤50 changed lines
- Files: `src/lib/embeddings/README.md` (modify) — `## Adding a source` gains
  the GloVe/word-vocab case (export with `scripts/export_word_vectors.py`,
  same four artefacts, `vocabSha` must match `word-vocab-50k.json` order);
  update the hosting inventory ("8 embedding files: two sources × four
  files" → three sources × four files plus `word-vocab-50k.json`) and note
  that `glove-840b-300d` pairs with the `words` tokenizer.
  `src/lib/tokenizers/README.md` (modify) — note the `words` tokenizer's
  paired embedding source.
  `AGENT_CONTEXT.md` (modify) — add the GloVe word-vector source beside the
  existing tokenizer/embedding summary (`:72-77`).
- Tests: none.
- Covers: AC4 (documented alignment contract)
- Commit: `docs(#78): document the GloVe word-vector source`
- Reviewer note: Docs only; check statements match the shipped behaviour.

### S9 — Bump the version

- Kind: mechanical
- Budget: ≤5 changed lines
- Files: `package.json` (modify) — `1.9.0` → `1.10.0` (highest commit type is
  `feat`, so minor).
- Tests: none.
- Covers: —
- Commit: `chore(#78): bump version to 1.10.0`
- Reviewer note: Confirm SemVer matches the highest commit type in this round.

## Coverage

- AC1 — S4 (source/tokenizer mapping unit test), S6 (pairing effect), S7
  (e2e: `tokenizer-words` and `embedding-source-glove-840b-300d` both
  selected, then a ready trajectory).
- AC2 — S1 (empty row for ids $\geq K$ and uniform `getLocalDistribution`),
  S5 (all static words are word-initial, so the predicate never filters out
  the vocabulary), S7 (scrub with an OOV present renders only valid ids).
- AC3 — S1 (seeded randomized id sweep plus naive differential test and
  out-of-range `distance` returning `Infinity`).
- AC4 — S2 (`vocab-sha.test.ts`, worker check), S3 (exporter writes a
  matching `vocabSha` in rank order), S4 (`vocabSize: 50_000`), S7 (e2e meta
  carries `vocabSha`, so the worker's size and sha checks pass).
- AC5 — full command set under Verification, per slice and per round.

## Smoke steps

Prerequisite: the S7 fixture route intercepts
`**/glove-840b-300d.*` and `**/word-vocab-50k.json`, so no network is needed.

- Load `/`, type `the cat walks zorblax`, click `tokenizer-words`, then click
  `strategy-embedding-knn` → the word tokenizer card and the
  `embedding-source-glove-840b-300d` card are both checked, the GPT-2 source
  card is not.
- Click `noise-button` → `app-status` reaches
  `data-trajectory-status="ready"` and shows `(+1 OOV seen)`.
- Drag `time-slider` to 0 → `prose-text` equals the typed input.
- Drag `time-slider` to its maximum; the Tokens view shows only integer ids
  in $0 \ldots 40$, with `` absent → no `NaN`, `undefined`, or blank
  labels anywhere.
- No page errors or console errors are emitted during the run.

Required test ids: `input-text`, `tokenizer-words`, `strategy-embedding-knn`,
`embedding-source-glove-840b-300d` (added in S6), `noise-button`,
`app-status`, `time-slider`, `prose-text`, `prose-token`, `output`.

## Verification

Per slice, from the slice commit's working tree:

- `node scripts/slice-check.mjs --budget <slice budget>` (runs
  `npm run check` → `npm run lint` → `npm run format` → `npm run test`, stages
  the slice, and measures changed lines). Exit 2 means split the slice.
- S3 additionally: `python3 -m py_compile scripts/export_word_vectors.py`.

Per round, before pushing:

- `npm run test` once more.
- `npm run e2e` (the plan has a `## Smoke steps` section; first run needs
  `npx playwright install chromium`).

## Edge cases and risks

- **OOV reachability:** with $\varepsilon > 0$ the uniform floor makes OOV ids
  reachable from any token; AC2 is about kNN targets, which only ever come
  from rows $< K$. The e2e fixture uses the default $\varepsilon = 0$.
- **OOV previews:** `precomputeRows` sees OOV ids from `distinctTokens`; the
  S1 guard makes each such lookup an empty memoized table instead of a scan.
- **Hosted bundle is not committed:** the pin `HF_DATASET_REVISION` in
  `src/lib/embeddings/loader.ts` is intentionally unchanged; publishing the
  GloVe upload and bumping the pin is a follow-up release step, and e2e uses
  route mocks. Manual runs against the real source need the upload first.
- **WebCrypto dependency:** `vocabSha` uses `crypto.subtle`, which requires a
  secure context (https or localhost); both the static site and the e2e
  preview satisfy this. Vitest on Node 22 provides the same global.
- **Export memory/IO:** the exporter streams the 5.6 GB GloVe text file and
  keeps only 50k rows, so memory stays at $50{,}000 \times 300$ floats; it is
  a manual, offline script and is not exercised by CI.
- **Source picker semantics:** the new effect makes the word tokenizer win
  over a manual GPT-2/BERT source choice only when word tokens are active;
  this is deliberate (there is exactly one word source).
- **Shared 300-dim artefacts:** the e2e fixture allocates a 300×300 identity
  whitening blob (~360 KB) per route fulfil; keep it deterministic and
  literal, not random.

## Out of scope

- Danish fastText (`cc.da.300`) and other language packs.
- Spelling-neighbour similarity for OOV words.
- Retuning $\tau$, $k$, or $\varepsilon$.
- Changing the default embedding source away from `gpt2`.
- Uploading the GloVe bundle and bumping `HF_DATASET_REVISION`.

## Open blocking questions

None.
