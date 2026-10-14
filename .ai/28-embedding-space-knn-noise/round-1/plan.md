# Plan — Issue #28: Embedding-space kNN noise

- Round: 1
- Addresses: none (initial plan)

## Goal

Add an `embedding-knn` noise strategy: a coupled random walk whose step
distribution is a softmax over the $k$ nearest neighbours of the current
token in a language-model token-embedding space. Distance $d(i,j)$ is
cosine or L2 between (optionally preprocessed, int8-quantized) LM
embedding rows, so noisy tokens drift to semantically related tokens
rather than spelling-similar ones.

The strategy plugs into the existing kernel abstraction (#49, landed):
a new `DistanceModel` backed by an embedding kNN index is wrapped in the
existing `NeighborhoodProvider`, so `createTokenKernel` /
`createKernelStrategy` / the graph builders are reused unchanged.

The embedding matrix is **not shipped with the app**. A committed Python
script exports a quantized `.bin` (+ meta/transform); the app fetches it
from a configurable external URL and caches it in IndexedDB.

## Acceptance criteria (from issue #28)

- AC1 — At least 2 embedding sources and 2 preprocessing options are
  selectable in the UI.
- AC2 — Lazy row computation does not block the UI; progress is shown.
- AC3 — Hubness and neighbour-overlap reports appear in diagnostics.
- AC4 — kNN-graph connectivity (disconnected components) is detected and
  surfaced.

## Scope decisions (authoritative — human, this session)

- **Data/hosting:** commit only `scripts/export_embeddings.py`; the app
  fetches the quantized `.bin` (+ meta/transform) from a configurable
  external URL and caches it in IndexedDB. No binary artefacts in git.
- **Round-1 scope:** full vertical slice — 2 sources × 2+ preprocessings,
  metric, token-class constraint, exclusions, lazy worker rows, IndexedDB
  cache, config UI, connectivity detection. Defer hubness/overlap/probe.
- **Sources:** `bert-base-uncased` (input word embeddings) and `gpt2`
  (`wte`), plus a `gpt2-lmhead` (`lm_head`) input-vs-output comparison
  variant.

### Acceptance deviations

- **AC3 deferred.** Hubness moves to #58; neighbour-overlap / probe-word
  tables move to the diagnostics follow-up (#12 stationarity panel). AC3
  is therefore **not** met this round and must be called out in the
  diff-report as a deliberate deviation. AC1, AC2, AC4 are met.
- AC4 is implemented generically (works for any strategy with a
  neighbourhood), but is exercised by the embedding strategy.

## Architecture

Reuse the #49 seam. New `EmbeddingDistanceModel implements DistanceModel`
(`src/lib/strategies/distance-model.ts:22`) exposes `candidates(token,
radius)` = the token's memoized top-$M$ embedding neighbours (filtered by
token class/exclusions) and `distance(a,b,maxDist)` = the metric on
transformed vectors. The worker wraps it in a normal `NeighborhoodProvider`
with `R_MAX = Infinity` and `maxStored = M` (`M = 200`, matching
`NEIGHBOR_STORE_LIMIT` in `trajectory.worker.ts:87`), so
`ModelDistanceSource`, `createTokenKernel`, `createKernelStrategy`,
`buildNeighborGraph`, and `buildUnionGraph` are reused without change.

$k$NN semantics differ from the string models: neighbours are the top-$M$
by metric (a $k$NN graph), not everything within a radius; `maxDistance`
becomes an optional secondary cutoff (default none).

## Files to create

### `scripts/export_embeddings.py`
- CLI: `--source <id>` (one of the `SOURCES` map below), `--out <dir>`.
- `SOURCES` map: `bert-base-uncased` -> model file
  `bert.embeddings.word_embeddings.weight`; `gpt2` -> `wte.weight`;
  `gpt2-lmhead` -> `lm_head.weight` (loaded with tied weights; note when
  identical to `wte`).
- Loads the matrix (safetensors), quantizes per-row symmetric int8
  (`scale_i = max_j|W_ij| / 127`), writes:
  - `<source>.int8.bin` — int8 codes, row-major, shape $K \times d$.
  - `<source>.scales.f32.bin` — `Float32Array` of length $K$.
  - `<source>.transform.f32.bin` — mean ($d$), top-$n$ PC basis
    ($d \times n$, $n=32$), eigenvalues ($n$), whitening matrix
    ($d \times d$); layout described by `meta`.
  - `<source>.meta.json` — `{ source, model, vocabSize, dim, dtype,
    quant, nPcs, offsets }`.
- Committed as source; not run by CI. Documented in the embeddings README.

### `src/lib/embeddings/types.ts`
- `type EmbeddingSourceId = 'bert-base-uncased' | 'gpt2' | 'gpt2-lmhead'`.
- `interface EmbeddingSourceInfo { id: EmbeddingSourceId; label: string; description: string; tokenizerId: string; dim: number; vocabSize: number; fileName: string }`.
- `type PreprocessId = 'none' | 'mean-center' | 'center-remove-pcs' | 'whiten'`.
- `type MetricId = 'cosine' | 'l2'`.
- `interface EmbeddingMeta { source: EmbeddingSourceId; model: string; vocabSize: number; dim: number; dtype: 'int8'; quant: 'per-row-symmetric'; nPcs: number }`.
- `interface TransformBundle { mean: Float32Array; pcs: Float32Array; eigenvalues: Float32Array; whitening: Float32Array }`.
- `interface QuantizedMatrix { codes: Int8Array; scales: Float32Array; vocabSize: number; dim: number }`.

### `src/lib/embeddings/sources.ts`
- `EMBEDDING_SOURCES: Record<EmbeddingSourceId, EmbeddingSourceInfo>` —
  three entries. `tokenizerId` is `'bert-base-uncased'` or `'gpt2'` and
  **must** match the app tokenizer (see step 12).
- `getEmbeddingSource(id)` with an `Object.hasOwn` guard (mirrors
  `registry.ts:148`).

### `src/lib/embeddings/preprocessing.ts`
- `PREPROCESSINGS: Record<PreprocessId, { id; label; description }>`.
- `applyPreprocess(vec: Float32Array, out: Float32Array, id: PreprocessId, t: TransformBundle): Float32Array` — `none` copies; `mean-center`
  subtracts mean; `center-remove-pcs` subtracts mean then removes the
  top-$n$ PC projections; `whiten` applies the $d\times d$ whitening
  matrix. Pure, allocation-free into `out`.

### `src/lib/embeddings/metric.ts`
- `METRICS: Record<MetricId, { id; label; description }>`.
- `metricDistance(a: Float32Array, b: Float32Array, id: MetricId): number`
  — cosine `1-cos(a,b)`; L2 `||a-b||_2`.

### `src/lib/embeddings/quantized-matrix.ts`
- `dequantizeRow(matrix: QuantizedMatrix, row: number, out: Float32Array): Float32Array`.

### `src/lib/embeddings/idb.ts`
- Minimal promise wrapper (`openDb`, `idbGet`, `idbPut`) over raw
  `indexedDB`, no dependency. DB `noisy-text-embeddings`; stores
  `matrices` (key `source`) and `rows`
  (key `source|preprocess|metric|k|token`). All calls guard
  `typeof indexedDB === 'undefined'` and return misses.

### `src/lib/embeddings/loader.ts`
- `EMBEDDING_BASE_URL` from `import.meta.env.VITE_EMBEDDING_BASE_URL`
  with a documented default constant.
- `async loadEmbedding(sourceId, onProgress?): Promise<{ matrix: QuantizedMatrix; transform: TransformBundle; meta: EmbeddingMeta }>`
  — IndexedDB hit -> decode; miss -> `fetch` the three `.bin` + meta,
  cache, decode. Reports byte progress.

### `src/lib/embeddings/knn-index.ts`
- `class EmbeddingKnnIndex` — ctor `(matrix, transform, preprocess, metric, m)`.
  - `topM(token): { ids: Int32Array; dists: Float32Array }` — lazy
    $O(K\cdot d)$ scan + bounded max-heap selection of the $M$ nearest,
    memoized per token (transformed rows memoized in a `Map<number,
    Float32Array>`).
  - `distance(a, b): number` — metric on transformed rows.
  - `async precomputeRows(tokens: Int32Array, onProgress?): Promise<void>`
    — chunked top-$M$ for a token set.
  - Optional IndexedDB persistence of rows keyed
    `source|preprocess|metric|m`.

### `src/lib/embeddings/embedding-distance-model.ts`
- `class EmbeddingDistanceModel implements DistanceModel` — ctor
  `(index, predicate: (id:number)=>boolean)`; `id =
  \`embedding:${source}:${preprocess}:${metric}\``; `K = index` vocab;
  `candidates(token, _radius)` = `index.topM(token).ids` filtered by
  `predicate`; `distance(a,b,maxDist)` = `index.distance(a,b)` with the
  `maxDist+1` early-exit convention.

### `src/lib/embeddings/index.ts`
Barrel re-exporting the public surface.

### `src/lib/embeddings/README.md`
File formats, quantization layout, how to add a source, IDB key scheme.

### `src/lib/strategies/embedding-knn.ts`
- `interface EmbeddingKnnConfig { sourceId: EmbeddingSourceId; preprocess: PreprocessId; metric: MetricId; tokenClass: 'any'|'word-initial'|'continuation'; excludeSpecial: boolean; excludeUnused: boolean; excludeByteFallback: boolean; maxDistance: number | null; k: number; epsilon: number; tau: number; family?: WeightFamilyId }`.
- `EMBEDDING_KNN_INFO: StrategyInfo` (`stationary: 'data-dependent'`,
  `plainName`, `gloss`, `tooltip.text` + `tooltip.math` in `$...$`).
  Math comment states
  `P(y|x) = (1-eps) * knn(y|x) + eps/K`,
  `knn(y|x) prop-to w_tau(d(x,y))` over the top-$k$ filtered embedding
  neighbours.
- `createEmbeddingKnn: StrategyFactory<EmbeddingKnnConfig>` — mirrors
  `createLexical` (`lexical.ts:89`): `family = getWeightFamily(...)`;
  `kernel = provider ? createTokenKernel(new ModelDistanceSource(provider.model, provider), family, {...}) : null`;
  return `createKernelStrategy({ info: EMBEDDING_KNN_INFO, config, vocabSize, kernel, epsilon })`. `sampleStep` therefore draws exactly 2
  rng values per call.

### `src/lib/strategies/embedding-filter.ts`
- `type TokenClass = 'any' | 'word-initial' | 'continuation'`.
- `classifyTokens(tokens: readonly string[], tokenizerId: string): Uint8Array`
  — per-token bitmask: bit0 word-initial, bit1 continuation, bit2 special
  (`[CLS]`, `</s>`, ...), bit3 unused (`[unusedN]`), bit4
  byte-fallback (`/^<0x[0-9A-Fa-f]{2}>$/`). GPT-2 word-initial = leading
  `Ġ`; BERT continuation = leading `##`.
- `buildTokenPredicate(classes: Uint8Array, cfg): (id:number)=>boolean`.

### `src/lib/components/EmbeddingParams.svelte`
Props-down/events-up (no store import), mirroring `LexicalParams.svelte`:
source `<select>`, preprocessing `<select>`, metric `<select>`,
token-class `<select>`, three exclusion checkboxes, and the shared
`k`/`tau`/`epsilon`/family controls (reuse `kernel-help.ts` tooltips).

### `src/lib/stores/embedding.svelte.ts`
Svelte 5 `$state` singleton: `{ sourceId, preprocess, metric, tokenClass,
excludeSpecial, excludeUnused, excludeByteFallback, k, epsilon, tau,
family, status }`, a `get params(): Record<string, unknown>`, and
`markReady()`. Browser-guarded like `lexical.svelte.ts`.

### `src/lib/engine/connectivity.ts`
- `interface ConnectivityReport { componentCount: number; largestComponentSize: number; isolatedCount: number; connected: boolean }`.
- `analyzeConnectivity(nodeCount, edgeSrc, edgeDst, edgeTraj): ConnectivityReport`
  — union-find over kNN edges (`edgeTraj[i] === 0`); `connected = componentCount <= 1`.

### Tests (paths in the Test section below)

## Files to modify

### `src/lib/strategies/registry.ts`
- Add `EMBEDDING_KNN_INFO` entry to `STRATEGIES` (`registry.ts:10-76`).
- Register `createEmbeddingKnn` in `STRATEGY_FACTORIES` (`:83-89`).
- Add an `embedding-knn` branch to `strategyConfigFor` (`:108-137`)
  returning the config above (`maxDistance: null` — `Infinity` is not
  JSON-serializable).

### `src/lib/strategies/index.ts`
Re-export `createEmbeddingKnn`, `EmbeddingKnnConfig`, and the filter
helpers (barrel only).

### `src/lib/strategies/README.md`
Add the `embedding-knn` row to the "Current strategies" table and a note
that its provider is embedding-backed.

### `src/lib/workers/trajectory.protocol.ts`
- Extend `TrajectoryWorkerPhase` (`:102`) with `'embeddings'`.
- Add `connectivity: ConnectivityReport | null` to `UnionGraph` (`:209-237`).

### `src/lib/workers/trajectory.worker.ts`
- Add `_embeddingCache = new Map<string, { model; provider; index }>()`.
- `async ensureEmbeddingProvider(sourceId, preprocess, metric, k, tokenizerId, cfg, onProgress)`
  — validate `EMBEDDING_SOURCES[sourceId].tokenizerId === tokenizerId`
  (else throw); `loadEmbedding`; `classifyTokens(await decodeVocab(tok))`;
  build predicate; construct `EmbeddingKnnIndex` +
  `EmbeddingDistanceModel` + `NeighborhoodProvider(model, Infinity, { maxStored: M })`.
  Cache key `embedding:${sourceId}:${preprocess}:${metric}:${k}:${cfgHash}`.
- In `handleCompute` (`:167`): add the `embedding-knn` branch; before the
  walk call `index.precomputeRows(distinct(spec.inputIds))` posting
  `'embeddings'` progress; then `getStrategy(...)`.
- In `handleNeighbors` (`:249`) and `handleUnionGraph` (`:338`): add the
  branch, build `graphParams` from the config, and pass the provider.

### `src/lib/engine/union-graph.ts`
- Add `connectivity: ConnectivityReport | null` to `UnionGraphData`
  (`:59-92`); compute via `analyzeConnectivity` after edges are built
  (`null` when `!hasNeighborhood`).

### `src/routes/+page.svelte`
- Extend `activeStrategyConfig` (`:44-55`) with an `embedding-knn` branch
  using `embeddingStore.params`.
- Render `<EmbeddingParams>` conditionally in the advanced region
  (~`:548-618`), alongside the existing `LexicalParams`/`CharOverlapParams`.
- Add an `'embeddings'` label to the `trajStatus` mapping (`:302-310`).
- On source change, call `selectTokenizer(EMBEDDING_SOURCES[sourceId].tokenizerId)`
  so the tokenizer matches the embedding vocabulary (see step 12).

### `src/lib/components/AdvancedPanel.svelte`
No structural change required; the existing Diagnostics section already
renders `strategyInfo.stationary` = `'data-dependent'`.

### `src/lib/components/FullGraph.svelte`
- Add a disconnected notice near the `truncated` notice (`:532-534`):
  when `graph.connectivity && !graph.connectivity.connected`, show
  "Neighbourhood graph is disconnected — N components (largest M nodes)."

### `package.json`
Bump `1.4.0` -> `1.5.0` (`feat` -> minor), once, in the round-1 commit.

## Expected reviewable surface

- **New logic (~700-900 LOC):** the `src/lib/embeddings/*` modules
  (quantization decode, preprocessing, metric, loader, kNN index, distance
  model), `embedding-filter.ts`, `connectivity.ts`. Highest-risk:
  `knn-index.ts` (correct top-$M$ + memoization) and `loader.ts` (IDB).
- **New UI (~150 LOC):** `EmbeddingParams.svelte`, `embedding.svelte.ts`.
- **Small wiring edits (behavioral):** `registry.ts`, `trajectory.worker.ts`,
  `trajectory.protocol.ts`, `union-graph.ts`, `+page.svelte`,
  `FullGraph.svelte`.
- **Mechanical:** README tables, `index.ts` barrel exports, `package.json`
  version.
- **Committed non-TS:** `scripts/export_embeddings.py` (~150 LOC), not
  exercised by CI.
- Reviewer budget: the embedding modules are the core; the wiring edits are
  small and follow the existing lexical/char-overlap branches verbatim.

## Ordered implementation steps

1. `src/lib/embeddings/types.ts` + `sources.ts` + `README.md`.
2. `quantized-matrix.ts`, `metric.ts`, `preprocessing.ts` (pure + tests).
3. `knn-index.ts` and `embedding-distance-model.ts` (pure + tests).
4. `idb.ts` and `loader.ts` (guarded; no IDB in node tests).
5. `src/lib/strategies/embedding-filter.ts` (pure + tests).
6. `src/lib/strategies/embedding-knn.ts`; register in `registry.ts` +
   `index.ts`; extend `registry.test.ts`.
7. `src/lib/engine/connectivity.ts` (+ test); wire into `union-graph.ts`.
8. `trajectory.protocol.ts`: add `'embeddings'` phase + `connectivity`.
9. `trajectory.worker.ts`: embedding provider cache + the three handler
   branches + `'embeddings'` progress.
10. `embedding.svelte.ts` + `EmbeddingParams.svelte`.
11. `+page.svelte`: config branch, params render, status label, tokenizer
    sync; `FullGraph.svelte` disconnected notice.
12. `scripts/export_embeddings.py`.
13. READMEs + `package.json` bump to `1.5.0`.

## Tests to add

- `src/lib/embeddings/quantized-matrix.test.ts` — dequantize round-trips
  within per-row scale tolerance.
- `src/lib/embeddings/metric.test.ts` — cosine/L2 known values; identical
  vectors -> 0.
- `src/lib/embeddings/preprocessing.test.ts` — `none` identity;
  `mean-center` zero-mean; `whiten` ~identity covariance on synthetic data.
- `src/lib/embeddings/knn-index.test.ts` — top-$M$ nearest on a tiny
  synthetic matrix; memoization; `distance` consistent with ranking.
- `src/lib/embeddings/embedding-distance-model.test.ts` — `candidates`
  filtered by predicate; `distance` early-exit at `maxDist+1`.
- `src/lib/strategies/embedding-knn.test.ts` — factory builds a strategy
  with/without provider; `sampleStep` draws exactly 2 rng values (count via
  a counting rng); null provider -> uniform; `stationary === 'data-dependent'`.
- `src/lib/strategies/embedding-filter.test.ts` — classification of
  representative GPT-2 (`Ġ`-prefixed, `<0x...>`) and BERT (`##`-prefixed,
  `[unusedN]`) strings; each exclusion toggles membership.
- `src/lib/engine/connectivity.test.ts` — single component; two clusters;
  isolated node; `edgeTraj===1` edges ignored.
- `src/lib/strategies/registry.test.ts` — extend existing well-formedness
  test to include `embedding-knn`.

All tests are pure/offline (synthetic matrices, no network, no IDB).

## Verification commands (in order)

1. `npm run check`
2. `npm run lint`
3. `npm run format`
4. `npm run test`

## Edge cases and risks

- **Tokenizer alignment:** the embedding rows are indexed by the source
  model's tokenizer, so `source.tokenizerId` must equal the app
  tokenizer. The plan auto-selects it on source change and the worker
  validates it. Decide whether to also disable the tokenizer picker while
  an embedding strategy is active (recommended).
- **Hosting:** `EMBEDDING_BASE_URL` must point at hosted artefacts; no
  binaries are committed. CI never fetches. This is a non-blocking config
  with a documented default.
- **`Infinity` is not JSON-serializable:** `maxDistance` uses `null` for
  "no cutoff" in configs.
- **GPT-2 input vs output:** `lm_head` is usually tied to `wte`; the
  comparison may be a no-op for base GPT-2 — note in the README.
- **kNN soundness:** `candidates` returns top-$M$ (a $k$NN graph), not all
  tokens within a radius; this differs from the string models and is
  documented in the strategy math comment.
- **Memory:** keep the matrix int8 (24 MB); memoize only transformed rows
  and top-$M$ lists (bounded). No full fp32 matrix materialized.
- **IDB/test env:** node has no `indexedDB`; loader/idb must guard and
  tests must not touch them.
- **RNG contract:** `sampleStep` must draw exactly 2 values (inherited
  from `createKernelStrategy`); pinned by a test.

## Out of scope (this round)

- Hubness diagnostics (#58); neighbour-overlap / probe-word tables (#12).
- Metropolis–Hastings (#59), kernel algebra (#60), word-level tokenizer +
  word vectors (#53).
- Runtime recomputation of preprocessing transforms (transforms are
  exported by the script and applied at runtime; the forward transform is
  not re-derived in-browser).
- Shipping embedding artefacts in the repository.

## Open questions

- Is `VITE_EMBEDDING_BASE_URL` (with a placeholder default) acceptable, or
  should the URL live in a different config surface?
- Confirm auto-switching the tokenizer to the embedding source's tokenizer
  (and disabling the picker while active) is the desired UX.
