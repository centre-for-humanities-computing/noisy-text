- Round: 3
- Commits: perf(#28): materialize embedding rows and precompute cosine norms (round 3)

Round 3 lands the Tier-1 performance work for `embedding-knn` with **no
change to outputs**: the transformed embedding matrix is now
materialized once into a contiguous `Float32Array` with precomputed
`Float64Array` cosine norms (cosine only), and `topM` scans read that
flat matrix through metric-specific inner loops instead of calling
`metricDistance` per row — removing the per-row dequantize +
preprocess + allocation work that dominated the ~1700 s T=300/L=229
repro. A new `'materializing'` progress phase ("Preparing vectors")
covers the one-time build, `precomputeRows` reports progress per token,
a budgeted warm-up BFS (≤2000 tokens / 15 s) precomputes the kNN graph
neighbourhood of the inputs so the walk mostly hits memory or the
IndexedDB cache, and one IndexedDB connection is now reused instead of
being opened/closed per call. The same commit fixes the three open
round-2 nits: the non-hermetic `EMBEDDING_BASE_URL` assertion
(R2-N1), the stale cache-key doc comments (R2-N2), and a math-comment
formatting nit (R2-N3). No `package.json` bump (same issue, round 3;
`version` stays `1.5.0`).

## Reading order

1. `src/lib/embeddings/knn-index.ts` — highest risk. The `topM` fast
   paths must be bit-identical to `metricDistance` (same accumulation
   order, exact cosine formula, `Float64Array` norms); any drift
   silently changes trajectories.
2. `src/lib/workers/trajectory.worker.ts` — `materialize()` call, the
   warm-up BFS, and `predicate` threading through
   `ensureEmbeddingProvider`/`_embeddingCache`. Behavioral.
3. `src/lib/embeddings/idb.ts` — connection memoization + lifecycle
   handlers. Behavioral, low risk.
4. `src/lib/embeddings/knn-index.test.ts` — parity/budget tests
   enforcing the bit-identity claim.
5. `src/lib/embeddings/idb.test.ts` — new Node-guard tests.
6. `src/lib/workers/trajectory.protocol.ts`, `src/routes/+page.svelte`
   — mechanical (one union member, one label).
7. `src/lib/embeddings/loader.test.ts` (R2-N1),
   `src/lib/embeddings/preprocessing.test.ts` (R2-N3) — test/comment
   only.
8. `src/lib/embeddings/README.md` — docs.

## Changed files

### `src/lib/embeddings/knn-index.ts` (behavioral)

- New option `materializeBudgetBytes` (default 256 MiB).
- New fields: `_flat` (contiguous $K \cdot d$ transformed rows),
  `_normSq` (cosine-only, length $K$, `Float64Array` — mandatory for
  bit-identity since `metricDistance` accumulates norms in doubles),
  `_materializing` (memoization handle), and `_heapIds`/`_heapDists`
  (length-$m$ heap scratch reused across `topM` calls).
- New `materialize(onProgress?)`: memoized, returns `false` over
  budget (lazy fallback), otherwise builds `_flat` row-chunk-wise
  (`dequantizeRow` → `applyPreprocess` into the flat subarray),
  accumulates `_normSq[row]` in the same index order as
  `metricDistance`, and yields + reports per chunk of `_chunkSize`.
  Returns `true` when the flat matrix is available.
- `_rowOf` returns a read-only `_flat` subarray when materialized;
  the bounded-memo lazy path is unchanged otherwise.
- `topM`: when `_flat` is set, per-metric inner loops (cosine uses
  `_normSq` with the exact `1 - dot/(Math.sqrt(nq)*Math.sqrt(nj))`
  form and the zero-norm guard; l2 is the same squared-sum order);
  otherwise the original `metricDistance` loop. Insertions route
  through a new `_offer` helper (identical logic to the old inline
  block). Heap sift logic, self-exclusion, and extraction order are
  unchanged; `ids`/`dists` stay freshly allocated (they are memoized,
  so reusing them as scratch would corrupt earlier tables — a
  documented deviation from the requirement sketch, which is fine
  because the plan resolves it this way).
- `precomputeRows`: progress is now reported per token
  (`onProgress?.(i + 1, total)`, including cache hits) instead of per
  chunk; the per-chunk yield is kept.
- Doc comments updated to the tagged cache-key scheme (R2-N2: class
  doc and `cacheKeyPrefix` option), and the class doc describes
  `materialize`.

### `src/lib/workers/trajectory.worker.ts` (behavioral)

- `handleCompute` (embedding-knn branch): after
  `ensureEmbeddingProvider`, `await emb.index.materialize(...)`
  posting `'materializing'` progress (memoized, so repeat computes
  skip it), then the input `precomputeRows`, then the warm-up BFS:
  seeded from the distinct inputs, expanding via
  `index.topM(token).ids` filtered by the predicate, batches
  precomputed with `'embeddings'` progress, bounded by
  `WARMUP_MAX_TOKENS = 2000` and `WARMUP_TIME_BUDGET_MS = 15000`
  (time budget is the primary bound).
- `ensureEmbeddingProvider` now also returns `predicate` (stored in
  `_embeddingCache`); the other two call sites use `.provider` and are
  untouched.
- Module doc: phase list now names all four phases.

### `src/lib/embeddings/idb.ts` (behavioral, low risk)

- `openDb` memoizes one `IDBDatabase` promise; `idbGet`/`idbPut` no
  longer close the handle per call. `onclose` / `onversionchange`
  drop the memo (version change also closes) so a lost connection
  reopens on the next call; an open failure nulls the memo so a
  retry reopens. `hasIndexedDb()` guards and try/catch behaviour are
  unchanged.
- Module doc: keys now shown with `@<EMBEDDING_CACHE_TAG>` (R2-N2).

### `src/lib/embeddings/knn-index.test.ts` (tests)

- New `EmbeddingKnnIndex.materialize` describe: parity tests —
  materialized vs lazy `topM` ids **and** dists compared with exact
  float equality (`toEqual`) for metric ∈ {cosine, l2} × preprocess ∈
  {none, mean-center (nonzero mean)} on the existing `lineMatrix`
  fixture, at tokens 0/3/10/19 — plus a budget-fallback test
  (`materializeBudgetBytes: 0` → `materialize()` resolves `false`,
  `topM` equals a default-budget reference).
- Existing `precomputeRows` progress test stays green: the final call
  is still `[total, total]` and ≥3 calls still hold (now 10 calls for
  10 tokens, one per token).

### `src/lib/embeddings/idb.test.ts` (new)

- Node no-op guard: `hasIndexedDb()` is false, `idbGet` resolves
  `undefined`, `idbPut` resolves. Connection reuse itself is covered
  by the browser smoke test (no fake-IDB injection, no new deps).

### `src/lib/embeddings/loader.test.ts` (tests, R2-N1)

- Removed the non-hermetic assertion
  `EMBEDDING_BASE_URL === hfResolvePrefix(...)` and its now-unused
  imports; kept the env-agnostic
  `EMBEDDING_CACHE_TAG === shortHash(EMBEDDING_BASE_URL)` test with a
  comment explaining why the default is not asserted.

### `src/lib/embeddings/preprocessing.test.ts` (comment, R2-N3)

- Comment rewritten as `$W = \mathrm{diag}(2, 1, \ldots, 1)$`.

### `src/lib/workers/trajectory.protocol.ts` (mechanical)

- `TrajectoryWorkerPhase` gains `'materializing'`.

### `src/routes/+page.svelte` (mechanical)

- `'materializing'` label "Preparing vectors" in the status line.

### `src/lib/embeddings/README.md` (docs)

- Module map: `materialize()`, the contiguous matrix + `Float64Array`
  norms, the budget fallback, per-token progress. `## Notes`: the
  transformed matrix is in-memory only; IDB connection reuse.

## Known limitations and residual risk

- Bit-identity of the fast paths rests on the same accumulation order
  and the exact cosine formula; the parity tests enforce it on the
  fixture, and the cosine zero-norm branch matches `metricDistance`,
  but an inadvertent future "optimization" (e.g. inverse norms) would
  reorder near-ties — the tests should catch it.
- `matrix.codes` is kept after materialization (public `readonly`
  member; the lazy fallback and `distance()` still use it), so
  materialized memory is ≈ `_flat` (147 MiB for gpt2) + codes +
  `_normSq`; the budget fallback covers low-memory cases but then
  performance reverts to the slow lazy path.
- Warm-up constants (2000 tokens / 15 s) are decision points per the
  plan; the time budget bounds total pre-walk work, but defaults
  should be confirmed in review.
- `'materializing'` fires once per index (memoized), so repeat
  computes skip it; `'embeddings'` totals still reset between
  `precomputeRows` calls/batches.
- Optional parts of the requirement left undone: batched per-chunk
  IDB puts (single transaction) and the same cosine-norm treatment
  for `distance(a, b)` — both explicitly optional in the plan;
  `distance()` still goes through `metricDistance`.
- Manual browser smoke test on the T=300/L=229 repro (wall-clock
  before/after, progress bar through "Preparing vectors" →
  "Computing embedding neighbours" → "Computing trajectory") still
  needs a human with the `.env`/dataset in place; not runnable here.
- The local `npm run lint` reports 82 errors — all from the untracked
  `.venv/` Python environment (not in CI, not part of this diff);
  zero errors in `src/`.

## Verification

- `npm run check` — 0 errors, 0 warnings.
- `npm run lint` — 0 problems in `src/` (82 errors, all in the
  untracked local `.venv/`; see above).
- `npm run format` — Prettier reports all files formatted.
- `npm run test` — 488 passed (42 files), up from 481: +6
  parity/budget tests, +3 `idb` guard tests, and the previously
  failing R2-N1 case removed.
- Browser smoke test deferred to the human (see limitations).
