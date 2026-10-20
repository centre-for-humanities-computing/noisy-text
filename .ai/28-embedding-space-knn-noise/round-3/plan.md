# Plan — Issue #28: Embedding-space kNN noise (round 3 — Tier-1 performance)

- Round: 3
- Addresses: R2-N1, R2-N2, R2-N3; new requirements

## Goal

Round 3 does two things on the same branch/PR #70, with **no change to
outputs** (bit-identical `topM` tables; no `computeTrajectory` RNG-order or
strategy/schedule math change):

- Fix the three open round-2 findings: a non-hermetic test (`R2-N1`),
  stale cache-key docs (`R2-N2`), one math-comment nit (`R2-N3`).
- Land the human's Tier-1 performance requirements: materialize the
  transformed embedding matrix into a contiguous `Float32Array` with
  precomputed `Float64Array` cosine norms, replace the per-row
  `metricDistance` scan in `topM` with metric-specific inner loops, add a
  `'materializing'` progress phase, add a budgeted warm-up BFS, and reuse
  one IndexedDB connection.

Target: the T=300/L=229 `embedding-knn` repro drops from ~1700 s to low
hundreds of seconds, with visible per-stage progress. No `package.json`
bump (round 3 of the same issue; `version` stays `1.5.0`).

## Acceptance criteria (issue #28)

Unchanged from rounds 1–2; round 3 does not move them.

- AC1 — ≥2 embedding sources and ≥2 preprocessings selectable (met; untouched).
- AC2 — lazy row computation doesn't block the UI; progress shown (met;
  round 3 adds a `'materializing'` stage and makes progress advance during
  materialize + warm-up, per the new requirements).
- AC3 — hubness + neighbour-overlap diagnostics (deliberately deferred to
  #58/#12; still deferred — out of scope).
- AC4 — kNN-graph connectivity detected and surfaced (met; untouched).

## New requirements

Verbatim from the human (text after `next`):

```text
Also add the following performance optimizations: Plan — Tier 1 performance fix for #28 (round 3)
Goal
Make embedding-knn trajectory computation ~5–10× faster with no change to outputs, and surface honest, moving progress. Target: the T=300/L=229 repro drops from ~1700s to low hundreds of seconds, with visible per-stage progress.
Non-goals
Worker-pool parallelization, dimensionality reduction/PCA, approximate kNN, and fixing the analogous string-distance (lexical/char-overlap) full-vocab scans — all deferred (Tier 2 / separate issue). No change to computeTrajectory's RNG order or to strategy/schedule math.
Step 1 — Materialize the transformed matrix + precompute cosine norms (src/lib/embeddings/knn-index.ts)
Add to EmbeddingKnnIndexOptions:
- materializeBudgetBytes?: number (default e.g. 256 MiB).
Add fields:
- private _flat: Float32Array | null = null; — contiguous K·d transformed rows.
- private _normSq: Float64Array | null = null; — cosine only, length K.
- private _materializing: Promise<void> | null = null;
Add async materialize(onProgress?: (done, total) => void): Promise<boolean>:
- Memoize via _materializing; return false immediately if already materialized or if K·d·4 > materializeBudgetBytes (fall back to the existing lazy path).
- Allocate _flat = new Float32Array(K*d). Over row chunks (yield + onProgress(end, K) per chunk, await new Promise(r => setTimeout(r, 0))): dequantizeRow(matrix, row, this._deq) then applyPreprocess(this._deq, this._flat.subarray(row*d, (row+1)*d), this.preprocess, this.transform).
- For metric === 'cosine', fill _normSq = new Float64Array(K) with Σ v[i]² accumulated in the same index order as metricDistance.
- Float64Array is mandatory: metricDistance accumulates norms in doubles; storing them in Float32Array would change the last ulp and reorder near-ties, changing trajectories/tests.
Change _rowOf (private): when _flat is set return this._flat.subarray(token*d, (token+1)*d) (read-only view); otherwise keep the existing bounded-memo lazy path. Keep _rows/_deq for the fallback.
Step 2 — Fast scan paths + scratch reuse in topM
In topM (knn-index.ts:93-135), replace the per-row metricDistance(query, _rowOf(j)) call with metric-specific inner loops when _flat is set:
- cosine: q = _flat.subarray(token*d, ...); nq = _normSq[token]; per j: dot = Σ q[k]·flat[j*d+k], then dist = (nq===0 || nj===0) ? 1 : 1 - dot/(Math.sqrt(nq)*Math.sqrt(nj)). Keep the exact formula — do not use precomputed inverse norms (breaks bit-identity).
- l2: Math.sqrt(Σ (q[k]-flat[j*d+k])²) over the subarray.
- Otherwise fall back to the existing metricDistance loop.
Heap logic (_siftUpMax/_siftDownMax, self-exclusion, extraction order) is unchanged so topM output is identical. Reuse heapIds/heapDists/ids/dists as class scratch fields to drop the ~4 per-call allocations (small but free). Optionally give distance(a,b) the same cosine-norm treatment.
Step 3 — New progress phase + finer reporting
- src/lib/workers/trajectory.protocol.ts:103 — extend TrajectoryWorkerPhase with 'materializing'.
- src/lib/routes/+page.svelte:317-322 — add label for 'materializing' (e.g. "Preparing vectors").
- src/lib/workers/trajectory.worker.ts handleCompute — after ensureEmbeddingProvider, await emb.index.materialize((done,total)=>postProgress('materializing',done,total)) (memoized, so cached/other requests are cheap).
- precomputeRows (knn-index.ts:206-236) — call onProgress?.(i+1, total) per token inside the batch loop (the worker's 100ms throttle in trajectory.worker.ts:281-293 coalesces), keeping the per-chunk yield. Update reporting granularity relative to chunkSize (default 128).
Step 4 — Budgeted warm-up BFS + persistent-cache reuse (trajectory.worker.ts)
After materialize + precomputeRows(distinctTokens(inputIds)), walk the kNN graph outward from the input set:
- BFS from the input tokens, enqueuing unseen ids from index.topM(token).ids (filtered by the predicate), calling precomputeRows on each frontier (which already reads the IDB rows cache).
- Bound by WARMUP_MAX_TOKENS (e.g. 2000) and/or WARMUP_TIME_BUDGET_MS (e.g. 15s); report under 'embeddings'.
- This makes most of the walk's reachable tokens either in-memory or IDB cache hits, moves cold work into a predictable progress-visible stage, and makes repeat sessions (after reload) fast. Constants are a decision point; time-budget is preferred so total pre-walk time stays bounded.
Step 5 — IDB connection reuse (src/lib/embeddings/idb.ts)
Memoize a single IDBDatabase promise across idbGet/idbPut (open once, reuse; handle onclose/onversionchange by dropping the cached handle) instead of openDb()+close() per call (idb.ts:25-78). Behavior in Node (no indexedDB) stays a guarded miss/no-op. Optionally batch precomputeRows puts per chunk in one transaction once a connection is reused.
Tests
- src/lib/embeddings/knn-index.test.ts: add parity tests — for each metric (cosine,l2) × representative preprocess (none,mean-center), the materialized path returns identical topM.ids/dists to the lazy path on the existing lineMatrix fixture; assert _normSq path equals metricDistance-based distances exactly; assert budget fallback (materializeBudgetBytes tiny) leaves behavior unchanged. Assert precomputeRows still reports a final [total,total] and ≥3 calls (existing test at knn-index.test.ts:115-125 stays green).
- Add a small idb.ts connection-reuse test if a fake indexedDB can be injected without new deps; otherwise cover via the existing Node no-op guard and manual check.
- No snapshot tests for math.
Docs
- src/lib/embeddings/README.md — module map: document materialize(), the contiguous transformed matrix + Float64Array norms, the budget fallback, and the warm-up BFS. Note in ## Notes that the transformed matrix is in-memory only (not IDB-persisted).
Verification
npm run check → npm run lint → npm run format → npm run test; then a manual browser smoke test on the T=300/L=229 repro recording before/after wall-clock and that the progress bar advances through "Preparing vectors" → "Computing embedding neighbours" → "Computing trajectory". Record the numbers in the round's diff-report.
Risks / decision points
- Memory: _flat ≈ 147 MiB (gpt2) + codes ≈ 38 MiB + _normSq 0.4 MiB; _topM can add up to ~80 MiB. The materializeBudgetBytes fallback covers oversize/低-memory cases. Consider dropping matrix.codes post-materialize (constrained by the public readonly matrix contract) — decide during implementation.
- Whiten: materialization is O(K·d²) ≈ 3e10 ops (~30s one-time) vs per-scan before — strictly better, chunked/progressed. Accepted.
- Warm-up constants: token vs time budget materially shifts pre-walk time; confirm the default in review.
- Bit-identity: enforced by the Float64Array norm + exact-formula constraints and the parity tests. Do not "optimize" to inverse norms.
Suggested commit: perf(#28): materialize embedding rows and precompute cosine norms (revision round, same branch/PR #70, no package.json bump).
```

Requirements-to-step mapping:

- Req Step 1 → `materialize()` + `_flat`/`_normSq` + `_rowOf` (step 2).
- Req Step 2 → metric-specific `topM` scan + scratch reuse (step 3).
- Req Step 3 → `'materializing'` phase + `precomputeRows` per-token progress (step 4).
- Req Step 4 → budgeted warm-up BFS (step 5).
- Req Step 5 → IDB connection reuse (step 6).
- Req Tests → parity/budget/idb-guard tests (steps 10–11).
- Req Docs → embeddings README (step 12).
- Req Verification → the ordered commands + manual smoke test (below).
- R2-N1/N2/N3 → steps 7–9.

## Findings and actions

- **R2-N1** (non-hermetic test) — `src/lib/embeddings/loader.test.ts:41-45`
  asserts `EMBEDDING_BASE_URL === hfResolvePrefix(HF_DATASET_REPO,
  HF_DATASET_REVISION)`, but the module value is
  `VITE_EMBEDDING_BASE_URL ?? default`; with the documented `.env` present
  the override wins and the test fails (`npm run test` 480/481). Action:
  delete that assertion (the requirement only asks for pure hash/tag/
  prefix tests) and keep the env-agnostic
  `EMBEDDING_CACHE_TAG === shortHash(EMBEDDING_BASE_URL)` test; leave
  `shortHash`/`hfResolvePrefix` tests untouched. See step 7.
- **R2-N2** (stale cache-key docs) — `src/lib/embeddings/idb.ts:5-7`,
  `src/lib/embeddings/knn-index.ts:20`, `src/lib/embeddings/knn-index.ts:38`
  still describe the pre-tag scheme. Action: update the three doc comments
  to the actual keys (`<source>@<EMBEDDING_CACHE_TAG>` for `matrices`;
  `<source>|<preprocess>|<metric>|<m>@<tag>|<token>` for `rows`). See step 8.
- **R2-N3** (math-comment nit) — `src/lib/embeddings/preprocessing.test.ts:63`
  uses `W = diag(2, 1, ..., 1)` outside `$...$`. Action: write
  `$W = \mathrm{diag}(2, 1, \ldots, 1)$`. See step 9.

## Files to create/modify

- `src/lib/embeddings/knn-index.ts` (behavioral) — options field,
  `_flat`/`_normSq`/`_materializing`/heap scratch fields, `materialize()`,
  `_rowOf` fast path, `topM` fast scan + `_offer` helper, `precomputeRows`
  per-token progress, doc fixes (R2-N2), class-doc materialize note.
- `src/lib/embeddings/idb.ts` (behavioral, low risk) — memoized
  `IDBDatabase` connection + reset on `close`/`versionchange`; doc fix
  (R2-N2).
- `src/lib/workers/trajectory.worker.ts` (behavioral) — `materialize()` call
  + `'materializing'` progress; warm-up BFS constants + loop;
  `ensureEmbeddingProvider` also returns `predicate`; module-doc phase list.
- `src/lib/workers/trajectory.protocol.ts` (mechanical) — extend
  `TrajectoryWorkerPhase` with `'materializing'`.
- `src/routes/+page.svelte` (mechanical) — `'materializing'` label.
- `src/lib/embeddings/knn-index.test.ts` (tests) — parity + budget cases.
- `src/lib/embeddings/idb.test.ts` (new, tests) — Node no-op guard.
- `src/lib/embeddings/loader.test.ts` (tests, R2-N1) — drop the
  non-hermetic assertion.
- `src/lib/embeddings/preprocessing.test.ts` (comment, R2-N3).
- `src/lib/embeddings/README.md` (docs) — materialize/contiguous matrix/
  norms/budget/warm-up; `## Notes` in-memory-only note.

### Exact shapes

`EmbeddingKnnIndexOptions` (add):

```ts
/** Max bytes for the materialized flat matrix; larger falls back to lazy. Default 256 MiB. */
materializeBudgetBytes?: number;
```

`EmbeddingKnnIndex` new members:

```ts
private _flat: Float32Array | null = null;
private _normSq: Float64Array | null = null;   // cosine only, length K
private _materializing: Promise<boolean> | null = null;
private readonly _heapIds: Int32Array;          // length m, scratch
private readonly _heapDists: Float32Array;      // length m, scratch
```

`materialize`:

```ts
async materialize(onProgress?: (done: number, total: number) => void): Promise<boolean>
```

Returns `true` when the flat matrix is available (already or newly built),
`false` when `K * d * 4 > materializeBudgetBytes` (lazy fallback). Memoized
through `_materializing`. `_materializing` is typed `Promise<boolean>`
(not `Promise<void>` in the sketch) so the memo carries the result in one
field; this is the only signature deviation from the requirement and is
functionally equivalent.

`_rowOf`:

```ts
private _rowOf(token: number): Float32Array {
    if (this._flat) return this._flat.subarray(token * this.matrix.dim, (token + 1) * this.matrix.dim);
    // ... existing bounded-memo lazy path unchanged
}
```

`_offer` (extracted heap insert, identical logic to the current inline
block at `knn-index.ts:109-118`):

```ts
private _offer(heapIds: Int32Array, heapDists: Float32Array, size: number, id: number, dist: number): number
```

`ensureEmbeddingProvider` return type becomes
`Promise<{ provider: NeighborhoodProvider; index: EmbeddingKnnIndex; predicate: (id: number) => boolean }>`;
the cached `_embeddingCache` value gains `predicate`.

Warm-up constants (in `trajectory.worker.ts`):

```ts
const WARMUP_MAX_TOKENS = 2000;      // cap on tokens warmed
const WARMUP_TIME_BUDGET_MS = 15_000; // wall-clock cap (preferred bound)
```

## Expected reviewable surface

- `knn-index.ts` — largest behavioral change (~120 lines): the new
  `materialize()` loop, the `topM` fast paths, the `_offer` extraction, and
  the doc edits. High risk: `topM` selection must stay bit-identical.
- `trajectory.worker.ts` — behavioral (~50 lines): one `await
  emb.index.materialize(...)`, the BFS block, the `predicate` threading.
- `idb.ts` — behavioral, low risk (~25 lines): connection memoization.
- `trajectory.protocol.ts`, `+page.svelte` — mechanical (one union member,
  one label line).
- Tests — new parity/budget cases (~60 lines) and one small new guard test
  (~15 lines).
- Docs — README edits (~20 lines).

Mechanical vs behavioral: the protocol/UI/doc/test-comment edits are
mechanical; `knn-index.ts`, `idb.ts`, and the worker BFS are behavioral.
Reviewer budget: concentrate on `knn-index.ts` bit-identity and the worker
BFS, skim the rest.

## Ordered implementation steps

1. **Branch check (no writes).** Confirm `git rev-parse --abbrev-ref HEAD`
   is `28-embedding-space-knn-noise`; do not bump `package.json`.
2. **`knn-index.ts` — fields + options + materialize.** Add
   `materializeBudgetBytes` to `EmbeddingKnnIndexOptions` (default
   `256 * 1024 * 1024`). Add `_flat`, `_normSq`, `_materializing`, and the
   `_heapIds`/`_heapDists` scratch fields (allocate length-`m` arrays in
   the constructor; do **not** reuse `ids`/`dists` as scratch — they are
   returned and memoized in `_topM`, so sharing them would corrupt earlier
   tables). Implement `materialize(onProgress?)`:
   - if `this._materializing` is set, `return` it (memoized);
   - if `K * d * 4 > budget`, set `_materializing = Promise.resolve(false)`
     and return `false`;
   - otherwise create `_materializing = (async () => { ... })()` that
     allocates `_flat = new Float32Array(K*d)`, allocates
     `_normSq = new Float64Array(K)` for cosine, and loops rows in chunks
     of `_chunkSize` (default 128): per row
     `dequantizeRow(this.matrix, row, this._deq)` then
     `applyPreprocess(this._deq, this._flat.subarray(row*d, (row+1)*d), this.preprocess, this.transform)`;
     for cosine accumulate `_normSq[row]` as a double sum over
     `k = 0..d-1` of `flat[row*d+k]²` (same index order as
     `metricDistance`); after each chunk call `onProgress(end, K)` and
     `await new Promise((r) => setTimeout(r, 0))`; resolve `true`.
3. **`knn-index.ts` — `_rowOf` + `topM` fast scan.** Change `_rowOf` to
   return a `_flat` subarray when set (read-only view) and keep the lazy
   path otherwise. In `topM`, when `_flat` is set use per-metric loops
   (cosine: `dot` over the two rows, `dist = (nq===0||nj===0) ? 1 : 1 -
   dot/(Math.sqrt(nq)*Math.sqrt(nj))`; l2: `Math.sqrt(Σ (q-flat)²)`);
   otherwise keep the existing `metricDistance(query, this._rowOf(j))`
   call. Route every insertion through the new `_offer` helper so the heap
   logic and self-exclusion are unchanged. Use `_heapIds`/`_heapDists` as
   scratch; extraction still allocates fresh `ids`/`dists`. Do **not**
   precompute inverse norms.
4. **`knn-index.ts` — `precomputeRows` progress.** Replace the per-chunk
   `onProgress?.(end, total)` (`:231`) with `onProgress?.(i + 1, total)`
   inside the per-token loop (keep the per-chunk yield). Final call is
   `[total, total]`.
5. **`trajectory.protocol.ts`.** Extend `TrajectoryWorkerPhase` to
   `'preparing' | 'materializing' | 'embeddings' | 'walking'` (`:103`).
6. **`trajectory.worker.ts` — materialize + warm-up.** After
   `ensureEmbeddingProvider` in the `embedding-knn` branch (`:314-322`):
   `await emb.index.materialize((done, total) => postProgress('materializing', done, total));`
   then `await emb.index.precomputeRows(distinctTokens(spec.inputIds), (done, total) => postProgress('embeddings', done, total));`
   then run the budgeted BFS: seed a `seen` set + frontier with
   `distinctTokens(spec.inputIds)`; while the frontier is non-empty and
   `warmed < WARMUP_MAX_TOKENS` and `performance.now() - start <
   WARMUP_TIME_BUDGET_MS`, for each frontier token read
   `emb.index.topM(token).ids`, collect unseen ids that pass the returned
   `predicate` into the next frontier, then
   `await emb.index.precomputeRows(nextBatch, (done, total) => postProgress('embeddings', done, total))`.
   Cap the batch so `warmed` never exceeds `WARMUP_MAX_TOKENS`. Change
   `ensureEmbeddingProvider` to also return `predicate` (store it in
   `_embeddingCache`; the other two call sites use `.provider` and are
   unaffected). Update the module doc phase list (`:15-18`).
7. **`loader.test.ts` (R2-N1).** Remove the `EMBEDDING_BASE_URL ===
   hfResolvePrefix(...)` assertion and its `describe` shell; keep
   `EMBEDDING_CACHE_TAG === shortHash(EMBEDDING_BASE_URL)`. This makes
   `npm run test` green under the documented `.env`.
8. **`idb.ts` (R2-N2 docs + Step 5).** Update the module doc (`:5-7`) to
   the tagged key scheme. Memoize the connection: replace per-call
   `openDb()`/`db.close()` with a module-level
   `let _dbPromise: Promise<IDBDatabase> | null = null` created once;
   attach `db.onclose`/`db.onversionchange` handlers that null `_dbPromise`
   (and close) so a dropped handle reopens; `idbGet`/`idbPut` keep their
   `hasIndexedDb()` guard and try/catch. Optional: batch the chunk's puts
   into one readwrite transaction.
9. **`knn-index.ts` (R2-N2 docs).** Update the class doc (`:20`) and the
   `cacheKeyPrefix` option doc (`:38`) to include `@<tag>`.
10. **`preprocessing.test.ts` (R2-N3).** Rewrite the comment at `:63` as
    `// $W = \mathrm{diag}(2, 1, \ldots, 1)$: the first component doubles.`
11. **Tests.** Extend `knn-index.test.ts` (see below); add `idb.test.ts`.
12. **Docs.** Update `src/lib/embeddings/README.md`.

## Tests to add

`src/lib/embeddings/knn-index.test.ts`:

- **Parity (materialized vs lazy)** — for each metric in `['cosine','l2']`
  × preprocess in `['none','mean-center']`, build two indices on the same
  `lineMatrix` fixture with a nonzero-mean transform for `mean-center`:
  a lazy one (default budget, never materialized) and one constructed with
  `materializeBudgetBytes: 1 << 30`; `expect(await mat.materialize()).toBe(true)`;
  for `t` in `[0, 3, 10, 19]` assert
  `Array.from(mat.topM(t).ids)` `toEqual` the lazy ids and
  `Array.from(mat.topM(t).dists)` `toEqual` the lazy dists (`toEqual` on
  floats is exact — this is the `_normSq`-equals-`metricDistance`
  assertion for cosine).
- **Budget fallback** — construct with `materializeBudgetBytes: 0`;
  `expect(await index.materialize()).toBe(false)`; assert `topM(7)` equals
  a default-budget reference.
- Existing `precomputeRows` progress test (`:115-125`) stays green; the
  final `[total, total]` and `≥3` calls still hold.
- No snapshot tests.

`src/lib/embeddings/idb.test.ts` (new, no new deps):

- `hasIndexedDb()` is `false` under vitest's node environment.
- `await expect(idbGet('rows', 'k')).resolves.toBeUndefined()` and
  `await expect(idbPut('rows', 'k', {})).resolves.toBeUndefined()` (the
  Node no-op guard). Connection reuse itself is exercised in the browser
  smoke test.

## Verification

Run in order from the repo root and record results in the round's
`diff-report.md`:

1. `npm run check`
2. `npm run lint`
3. `npm run format`
4. `npm run test`

Then a manual browser smoke test on the T=300/L=229 `embedding-knn` repro,
recording before/after wall-clock and confirming the progress bar advances
through "Preparing vectors" → "Computing embedding neighbours" →
"Computing trajectory".

## Edge cases, risks, out-of-scope, open questions

- **Heap output identity.** The metric-specific loops must reproduce
  `metricDistance` bit-for-bit: same index order, doubles for
  accumulation, and the exact `1 - dot/(Math.sqrt(nq)*Math.sqrt(nj))`
  form (no inverse norms). The parity tests enforce this.
- **`ids`/`dists` scratch.** The requirement suggests reusing them, but
  they are returned and stored in `_topM`; reusing them would corrupt
  previously memoized tables. Only `_heapIds`/`_heapDists` are reused;
  `ids`/`dists` stay freshly allocated per token. This is a deliberate,
  documented deviation.
- **Budget fallback.** On oversize matrices (`K*d*4 > budget`) behaviour is
  unchanged but slow (lazy path) and the BFS warm-up is effectively capped
  by the time budget.
- **Memory.** `_flat` ≈ 154 MB for gpt2 (50257×768) and ≈ 94 MB for BERT;
  the 256 MiB default admits both. `_normSq` ≈ 0.4 MB. We do **not** drop
  `matrix.codes` after materialize (it is a public `readonly matrix`
  member and the lazy fallback/`distance` still use it) — decided: keep it.
- **Warm-up constants.** `WARMUP_MAX_TOKENS = 2000` and
  `WARMUP_TIME_BUDGET_MS = 15000`; the time budget is the primary bound.
  Confirm defaults in review.
- **Progress semantics.** `'materializing'` fires once per index
  (memoized), so later computes skip it; per-`precomputeRows`-call
  `'embeddings'` totals still reset between calls/batches. Acceptable.
- **Node/SSR.** `idb.ts` keeps `hasIndexedDb()` guards; the connection
  memo is only created inside the guarded path.
- **Out of scope (non-goals).** Worker-pool parallelization, PCA/
  dimensionality reduction, approximate kNN, string-distance full-vocab
  scans, hubness/overlap diagnostics (AC3; #58/#12), removing the unused
  `k` parameter from `ensureEmbeddingProvider` (a round-2 open question,
  not an open finding).
- **Open blocking questions.** None; the `ids`/`dists` scratch deviation is
  resolved above with rationale and surfaced for the reviewer.
