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
- `knn-index.ts` — $O(K \cdot d)$ scan + bounded max-heap top-$M$
  selection, memoized per token; chunked `precomputeRows` (progress per
  token). `materialize()` builds a contiguous `Float32Array` of all $K$
  transformed rows plus `Float64Array` cosine norms (cosine only) once,
  after which scans read the flat matrix directly; oversized matrices
  ($K \cdot d \cdot 4$ above `materializeBudgetBytes`, default 256 MiB)
  fall back to the lazy per-row path with identical results.
- `embedding-distance-model.ts` — `DistanceModel` adapter: `candidates`
  = top-$M$ ids filtered by a token predicate (kNN semantics, not
  radius semantics); `distance` with the `maxDist + 1` early-exit
  convention.
- `idb.ts` — minimal IndexedDB wrapper (no dependency), guarded so node
  tests/SSR degrade to cache misses.
- `loader.ts` — fetch + decode + IndexedDB caching of the export
  bundle; base URL from `VITE_EMBEDDING_BASE_URL` (default: the pinned
  HF dataset revision, see `## Hosting`).

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

- `matrices`, key `<source>@<EMBEDDING_CACHE_TAG>` — the full decoded
  bundle (typed arrays).
- `rows`, key
  `<source>|<preprocess>|<metric>|<m>@<tag>|<token>` — memoized
  top-$M$ tables `{ ids: Int32Array, dists: Float32Array }`.

`EMBEDDING_CACHE_TAG` is an 8-hex FNV-1a hash of `EMBEDDING_BASE_URL`
(exported from `loader.ts`). Cache invalidation is structural: the keys
pin the parameters that shape the stored rows, so a parameter or
revision change simply uses different keys (old entries are orphaned,
harmlessly).

## Hosting

Bundles are hosted on the HF dataset repo `chcaa/noisy-text-embeddings`
(flat layout, 8 files: two sources × four files above). Artefacts
download from

```
https://huggingface.co/datasets/chcaa/noisy-text-embeddings/resolve/<revision>/<file>
```

The default `EMBEDDING_BASE_URL` pins an immutable commit sha in
`loader.ts` (`HF_DATASET_REVISION`); the `resolve` endpoint serves it
with CORS + `Content-Length`. `VITE_EMBEDDING_BASE_URL` overrides the
default at build time (no trailing slash).

## Re-export runbook

1. `hf auth login` (or set `HF_TOKEN`).
2. Once per source:
   `python scripts/export_embeddings.py --source <id> --out dist/embeddings --repo chcaa/noisy-text-embeddings`
   (`--revision` targets a specific branch; omit for the repo default).
   The script writes the dataset card and uploads the folder, printing
   the new commit sha.
3. Copy the printed sha into `HF_DATASET_REVISION` in
   `src/lib/embeddings/loader.ts` (or set `VITE_EMBEDDING_BASE_URL`).
   The cache tag changes automatically, invalidating old IDB entries.

## Adding a source

1. Add an entry to `EMBEDDING_SOURCES` in `sources.ts` (id, label,
   description, `tokenizerId`, `dim`, `vocabSize`, `fileName`).
2. Add the source to `SOURCES` in `scripts/export_embeddings.py` and
   run it: `python scripts/export_embeddings.py --source <id> --out <dir>`.
3. Host the four files under the HF dataset repo (see `## Hosting`),
   then pin the new revision.

## Notes

- Recommended strategy defaults (matching the store and registry
  fallback): `preprocess: 'mean-center'`, `tokenClass: 'word-initial'`,
  `k: 20`, `tau: 0.1`, `epsilon: 0`, `family: 'exponential'`.
- The browser applies the exported transforms; it never re-derives them.
- Node has no `indexedDB`; `idb.ts` guards every call and `loader.ts`
  degrades to network-only. The IDB connection is opened once and reused
  (the handle is dropped on `close`/`versionchange` and reopens lazily).
- The materialized transformed matrix is in-memory only (never persisted
  to IndexedDB); only top-$M$ rows are cached there.
