# Embeddings

Embedding-space substrate for the `embedding-knn` strategy (#28): quantized
LM token-embedding matrices fetched at runtime, a lazy kNN index over them,
and a `DistanceModel` adapter that plugs into the #49 kernel seam.

The matrix is **not shipped with the app** and nothing here runs in CI.

## Module map

- `types.ts` — shared shapes (`EmbeddingSourceId`, `QuantizedMatrix`,
  `TransformBundle`, `EmbeddingMeta`).
- `sources.ts` — registry of sources (`EMBEDDING_SOURCES`,
  `getEmbeddingSource`). `tokenizerId` must match an app tokenizer; the
  worker validates the pairing.
- `quantized-matrix.ts` — per-row-symmetric int8 dequantization
  ($\hat W_{ij} = \mathrm{code}_{ij} \cdot \mathrm{scale}_i$).
- `preprocessing.ts` — `none` / `mean-center` / `center-remove-pcs` /
  `whiten`, applied to dequantized rows.
- `metric.ts` — cosine ($1 - \cos$) and L2 distances.
- `knn-index.ts` — lazy $O(K \cdot d)$ scan + bounded max-heap top-$M$
  selection, memoized per token; chunked `precomputeRows`.
- `embedding-distance-model.ts` — `DistanceModel` adapter: `candidates`
  = top-$M$ ids filtered by a token predicate (kNN semantics, not
  radius semantics); `distance` with the `maxDist + 1` early-exit
  convention.
- `idb.ts` — minimal IndexedDB wrapper (no dependency), guarded so node
  tests/SSR degrade to cache misses.
- `loader.ts` — fetch + decode + IndexedDB caching of the export
  bundle; base URL from `VITE_EMBEDDING_BASE_URL`.

## File formats (produced by `scripts/export_embeddings.py`)

For a source with base name `<source>`:

- `<source>.int8.bin` — int8 codes, row-major, $K \times d$.
- `<source>.scales.f32.bin` — `Float32Array` of length $K$:
  $\mathrm{scale}_i = \max_j |W_{ij}| / 127$.
- `<source>.transform.f32.bin` — one float32 blob laid out as
  1. `mean`: $d$ floats,
  2. `pcs`: $d \times n$ floats, row-major ($n$ = `nPcs`),
  3. `eigenvalues`: $n$ floats,
  4. `whitening`: $d \times d$ floats, row-major.
- `<source>.meta.json` — `{ source, model, vocabSize, dim, dtype,
quant, nPcs }`.

## IndexedDB key scheme

DB `noisy-text-embeddings`:

- `matrices`, key `<source>` — the full decoded bundle (typed arrays).
- `rows`, key `<source>|<preprocess>|<metric>|<m>|<token>` — memoized
  top-$M$ tables `{ ids: Int32Array, dists: Float32Array }`.

Cache invalidation is structural: the keys pin the parameters that shape
the stored rows, so a parameter change simply uses different keys.

## Adding a source

1. Add an entry to `EMBEDDING_SOURCES` in `sources.ts` (id, label,
   description, `tokenizerId`, `dim`, `vocabSize`, `fileName`).
2. Add the source to `SOURCES` in `scripts/export_embeddings.py` and
   run it: `python scripts/export_embeddings.py --source <id> --out <dir>`.
3. Host the four files under `VITE_EMBEDDING_BASE_URL`.

## Notes

- `gpt2-lmhead` exports `lm_head.weight`; for base GPT-2 it is tied to
  `wte`, so the input-vs-output comparison may be a no-op.
- The browser applies the exported transforms; it never re-derives them.
- Node has no `indexedDB`; `idb.ts` guards every call and `loader.ts`
  degrades to network-only.
