- Round: 1
- Commits: feat(#28): add embedding-space kNN noise strategy (round 1)

## Summary

This round adds the `embedding-knn` noise strategy: a coupled random walk
whose step distribution is a softmax over the $k$ nearest neighbours of the
current token in a language-model token-embedding space (cosine or L2 over
optionally preprocessed, int8-quantized rows), so tokens drift to
semantically related tokens rather than spelling-similar ones. It reuses the
#49 kernel seam unchanged (`EmbeddingDistanceModel` →
`NeighborhoodProvider` → `createTokenKernel` → `createKernelStrategy`), so
the graph builders, inspector, and union graph all work with it. The
embedding matrix is not shipped: a committed Python script exports a
quantized bundle, the app fetches it from `VITE_EMBEDDING_BASE_URL` and
caches it in IndexedDB. kNN connectivity is analyzed and surfaced in the
full-graph view. AC1 (2 sources × 2+ preprocessings selectable), AC2 (lazy
rows with an `'embeddings'` progress phase), and AC4 (connectivity notice)
are met. **AC3 is deliberately deferred** per the plan: hubness moves to
#58 and neighbour-overlap/probe tables to the #12 diagnostics follow-up.

## Reading order (highest risk first)

1. `src/lib/embeddings/knn-index.ts` — hand-rolled bounded max-heap
   top-$M$ selection + row memoization; the core correctness risk.
2. `src/lib/embeddings/loader.ts` — fetch/decode/IndexedDB path and the
   transform-blob layout math.
3. `src/lib/workers/trajectory.worker.ts` — the embedding provider cache
   and the three handler branches.
4. `src/lib/embeddings/embedding-distance-model.ts` +
   `src/lib/engine/union-graph.ts` — soundness semantics (kNN vs radius)
   and the connectivity wiring.
5. `src/lib/embeddings/preprocessing.ts`, `metric.ts`,
   `quantized-matrix.ts` — small pure math.
6. `src/lib/strategies/embedding-knn.ts` + `embedding-filter.ts` +
   `registry.ts` — strategy wiring (mirrors `lexical.ts`).
7. UI: `EmbeddingParams.svelte`, `embedding.svelte.ts`, `+page.svelte`,
   `FullGraph.svelte`.
8. `scripts/export_embeddings.py` — committed source, never run by CI.

## Changed files

### New — `src/lib/embeddings/`

- `types.ts` — shared shapes (`EmbeddingSourceId`, `PreprocessId`,
  `MetricId`, `QuantizedMatrix`, `TransformBundle`, `EmbeddingMeta`).
  Behavioral: no (types only).
- `sources.ts` — `EMBEDDING_SOURCES` registry (bert-base-uncased input,
  gpt2 `wte`, gpt2-lmhead) + `getEmbeddingSource` with an `Object.hasOwn`
  guard, mirroring `registry.ts`. Behavioral: no.
- `quantized-matrix.ts` — `dequantizeRow`: $\hat W_{ij} = code \cdot
  scale_i$, allocation-free into `out`. Behavioral: yes (math).
- `metric.ts` — `METRICS` registry + cosine ($1-\cos$) / L2. Behavioral:
  yes (math).
- `preprocessing.ts` — `PREPROCESSINGS` + `applyPreprocess` (`none`,
  `mean-center`, `center-remove-pcs` with column-major $d \times n$ PC
  basis, `whiten` with a module-level scratch buffer). Behavioral: yes
  (math).
- `knn-index.ts` — `EmbeddingKnnIndex`: lazy $O(K \cdot d)$ scan with a
  bounded max-heap for top-$M$, memoized tables and transformed rows
  (FIFO-bounded), chunked `precomputeRows` with yields, and optional row
  persistence behind an injected `RowCache`. Behavioral: yes (core).
- `embedding-distance-model.ts` — `DistanceModel` adapter; `candidates`
  = predicate-filtered top-$M$ (kNN semantics, `radius` ignored),
  `distance` follows the `maxDist + 1` early-exit convention. Behavioral:
  yes (seam adaptation).
- `idb.ts` — promise wrapper over raw `indexedDB` (DB
  `noisy-text-embeddings`, stores `matrices`/`rows`); every call guards
  `typeof indexedDB === 'undefined'` and degrades to miss/no-op. No
  dependency added. Behavioral: yes.
- `loader.ts` — `EMBEDDING_BASE_URL` from
  `import.meta.env.VITE_EMBEDDING_BASE_URL` (documented placeholder
  default), `loadEmbedding` with byte progress: IDB hit → decode, else
  fetch the three `.bin` + meta, cache, decode; validates meta.source and
  the transform blob length. Behavioral: yes.
- `index.ts` — barrel. Mechanical.
- `README.md` — file formats, layouts, IDB key scheme, how to add a
  source. Mechanical.
- Tests: `quantized-matrix.test.ts`, `metric.test.ts`,
  `preprocessing.test.ts`, `knn-index.test.ts`,
  `embedding-distance-model.test.ts` — all pure/offline.

### New — strategies / engine

- `src/lib/strategies/embedding-knn.ts` — `EmbeddingKnnConfig`,
  `EMBEDDING_KNN_INFO` (math comment: $P(y|x) = (1-\varepsilon)\,\mathrm{knn}
  + \varepsilon/K$ over the top-$k$ filtered neighbours),
  `createEmbeddingKnn` mirroring `createLexical`; `maxDistance: null`
  becomes `Infinity` at kernel time; inherits the exactly-2-rng contract
  from `createKernelStrategy`. Behavioral: yes.
- `src/lib/strategies/embedding-filter.ts` — `classifyTokens` bitmask
  (word-initial/continuation/special/unused/byte-fallback; GPT-2 `Ġ`
  prefix vs BERT `##`) and `buildTokenPredicate`. Behavioral: yes.
- `src/lib/engine/connectivity.ts` — `analyzeConnectivity`: union-find
  over `edgeTraj === 0` edges; isolated nodes count as their own
  components. Behavioral: yes.
- Tests: `embedding-knn.test.ts` (2-rng contract, null-provider uniform,
  kernel jumps), `embedding-filter.test.ts`, `connectivity.test.ts`.
- `registry.test.ts` — extended: `embedding-knn` well-formedness, config
  defaults (`maxDistance: null`, exclusions on), `_extra` passthrough,
  factory instantiation. Behavioral: test-only.

### Modified

- `src/lib/strategies/registry.ts` — `EMBEDDING_KNN_INFO` in `STRATEGIES`,
  `createEmbeddingKnn` in factories, `embedding-knn` branch in
  `strategyConfigFor` (`maxDistance: null` — `Infinity` is not
  JSON-serializable). Behavioral.
- `src/lib/strategies/index.ts` — barrel re-exports. Mechanical.
- `src/lib/strategies/README.md` — table row + provider note. Mechanical.
- `src/lib/workers/trajectory.protocol.ts` — `'embeddings'` phase;
  `connectivity: ConnectivityReport | null` on `UnionGraph`. Behavioral.
- `src/lib/workers/trajectory.worker.ts` — `_embeddingCache`;
  `ensureEmbeddingProvider` (validates `source.tokenizerId === tokenizerId`,
  vocab-size check, classifies vocab, index+model+provider with
  $R_{\max} = \infty$, `maxStored = NEIGHBOR_STORE_LIMIT`, cache key
  `embedding:source:preprocess:metric:k:cfgHash`); `embedding-knn`
  branches in `handleCompute` (with chunked `precomputeRows` over the
  distinct input ids posting `'embeddings'` progress), `handleNeighbors`,
  and `handleUnionGraph`; `connectivity` copied through to the response.
  Behavioral.
- `src/lib/engine/union-graph.ts` — `connectivity` field on
  `UnionGraphData`, computed via `analyzeConnectivity` after the edge
  snapshot (`null` when `!hasNeighborhood`). Behavioral.
- `src/lib/stores/embedding.svelte.ts` — new `$state` singleton,
  browser-guarded like `lexical.svelte.ts`; `params` always pins
  `maxDistance: null`. Behavioral (new UI state).
- `src/lib/components/EmbeddingParams.svelte` — props-down/events-up
  controls (source/preprocess/metric/token-class selects, three exclusion
  checkboxes, shared k/ε/τ/family with `kernel-help.ts` tooltips),
  mirroring `LexicalParams.svelte`. Behavioral (new UI).
- `src/routes/+page.svelte` — `embedding-knn` branch in
  `activeStrategyConfig`; tokenizer-lock (`tokenizerLocked`) while the
  strategy is active plus an effect that auto-selects the source's
  tokenizer; `'embeddings'` status label; `embeddingStore.markReady()`;
  `<EmbeddingParams>` in the advanced region. Behavioral.
- `src/lib/components/FullGraph.svelte` — disconnected-graph notice next
  to the truncated notice. Behavioral.
- `scripts/export_embeddings.py` — new CLI exporter (safetensors → int8 +
  scales + transform + meta, PCA/whitening transform, per-row symmetric
  quantization). Committed source only; not exercised by CI.
- `package.json` — `1.4.0` → `1.5.0` (feat → minor, round-1 bump).
  Mechanical.

## Known limitations and residual risk

- **AC3 deferred** (deliberate): no hubness or neighbour-overlap reports
  this round (#58, #12).
- **Artefact hosting is a placeholder**: `EMBEDDING_BASE_URL` defaults to
  an invalid domain; until `VITE_EMBEDDING_BASE_URL` is configured, the
  strategy will surface a fetch error at compute time. No binaries in
  git, per scope decision.
- **kNN semantics**: neighbourhoods are top-$M$ by metric, not radius
  sets; `maxDistance` is an optional secondary cutoff (UI leaves it
  `null`). Documented in the strategy math comment and READMEs.
- **Provider cache breadth**: `_embeddingCache` keys include the filter
  config hash, so changing token-class/exclusion toggles rebuilds the
  index (the int8 matrix is re-decoded from IDB, cheap, but the top-$M$
  memo is per-index). Acceptable for round 1; could be split
  predicate-vs-index later.
- **`gpt2-lmhead` is usually identical to `gpt2`** (tied weights) — noted
  in the source description; the comparison is provided for completeness.
- The Python script's sharded-checkpoint path raises a clear error
  instead of loading index shards; fine for the three pinned sources.
- Tests never touch IndexedDB (node env); the IDB paths are guarded but
  only exercised manually in a browser.

## Verification

- `npm run check` — 0 errors, 0 warnings.
- `npm run lint` — clean.
- `npx prettier --check .` — clean (after `npm run format`).
- `npm run test` — 470 passed (40 files), including the 9 new test files.
