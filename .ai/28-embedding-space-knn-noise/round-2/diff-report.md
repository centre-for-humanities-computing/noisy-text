- Round: 2
- Commits: fix(#28): wire RowCache, fix kNN heap, host bundles on HF dataset repo (round 2)

Round 2 fixes the round-1 blocker in the kNN index (the bounded max-heap
never maintained its invariant while filling, so returned "top-M" lists
could be wrong), wires the previously dead `RowCache` persistence into
the worker, narrows the embedding provider cache key to only the fields
that shape stored rows, and forwards byte-progress from the matrix
fetch to the UI. It also lands HF Hub artefact hosting: the default
`EMBEDDING_BASE_URL` now points at a pinned revision of the
`chcaa/noisy-text-embeddings` dataset, matrices are cached under a
revision-derived cache tag (automatic invalidation on re-export), the
Python exporter gained `--repo`/`--revision` upload with a dataset
card, and docs/`.env.example` document the runbook.

## Reading order

1. `src/lib/embeddings/knn-index.ts` — the blocker fix (heap
   correctness). Highest risk: this changes neighbour selection for
   every embedding-knn query.
2. `src/lib/workers/trajectory.worker.ts` — cache-key narrowing +
   row-cache injection + progress passthrough. Behavioral.
3. `src/lib/embeddings/loader.ts` — new HF constants, `shortHash`,
   cache tag, keyed matrices store. Behavioral.
4. `src/lib/embeddings/knn-index.test.ts` — regression coverage for 1
   and the RowCache contract.
5. Everything else is low-risk wiring, docs, or dead-code removal.

## Changed files

### `src/lib/embeddings/knn-index.ts` (behavioral)

- `topM` now sifts up from the actual insertion index on every insert
  while the heap is filling (`_siftUpMax(heapDists, heapIds, size)`),
  instead of sifting once from `dists.length - 1` only when the heap
  just filled. Before, the array was not a valid max-heap at fill time,
  so extraction could emit non-nearest neighbours (R1-B1).
- `_siftUpMax` takes an explicit `start` index.
- Removed the unused `_pre` scratch buffer (R1-N4).
- Class doc: the `RowCache` is now described as injected by the worker
  (matches the new wiring).

### `src/lib/workers/trajectory.worker.ts` (behavioral)

- Provider cache key drops `k` and the `JSON.stringify(cfg)` blob; it
  is now `embedding:<source>:<preprocess>:<metric>:<predicateSignature>`
  (R1-N2). `_embeddingCache` doc comment updated.
- `loadEmbedding(sourceId, onProgress)` — byte progress is reported
  under the `'preparing'` phase (R1-N3).
- The index is constructed with `cache: idbRowCache` and
  `cacheKeyPrefix = <source>|<preprocess>|<metric>|<M>@<EMBEDDING_CACHE_TAG>`,
  so `precomputeRows` reads/writes the IDB `rows` store and invalidates
  with the bundle revision (R1-N1 + req 3).

### `src/lib/embeddings/loader.ts` (behavioral)

- New exports: `HF_DATASET_REPO`, `HF_DATASET_REVISION` (placeholder
  `REPLACE_WITH_UPLOAD_SHA` until the human pastes the upload sha),
  `hfResolvePrefix`, `shortHash` (FNV-1a → 8 hex), `EMBEDDING_CACHE_TAG`.
- `EMBEDDING_BASE_URL` defaults to the pinned HF resolve prefix;
  `VITE_EMBEDDING_BASE_URL` still overrides.
- The `matrices` IDB store is keyed `<source>@<EMBEDDING_CACHE_TAG>`
  (read + write), so a revision change orphans old bundles instead of
  serving stale matrices (req 2).

### `src/lib/embeddings/idb.ts` (behavioral, low risk)

- `idbRowCache` adapter over the `rows` store (type-only import of
  `RowCache`; no runtime cycle). `ROW_STORE` stays module-private.

### `src/lib/embeddings/index.ts` (mechanical)

- Re-exports the new loader/idb symbols (`EMBEDDING_CACHE_TAG`,
  `HF_DATASET_*`, `hfResolvePrefix`, `shortHash`, `idbRowCache`).

### `src/lib/strategies/embedding-filter.ts` (behavioral, low risk)

- `predicateSignature(cfg)` — stable string of `tokenClass` + the three
  exclusion flags, used by the worker cache key (R1-N2).

### `src/lib/strategies/distance-model.ts` (doc-only)

- `candidates` doc gains the kNN exception note: kNN-backed models
  return a fixed top-$M$ set, are not radius-sound, and must be wrapped
  with $R_{\max} = \infty$ (R1-N5).

### `src/lib/stores/embedding.svelte.ts`, `src/routes/+page.svelte` (mechanical)

- Removed dead `EmbeddingStatus`, `status`, `markReady()` and the
  `+page.svelte` call (R1-N4); the unused `browser` import went with it.

### `scripts/export_embeddings.py` (not run by CI)

- `--repo` / `--revision` args; when `--repo` is given it writes
  `DATASET_CARD` to `<out>/README.md`, `create_repo(repo_type="dataset",
  exist_ok=True)`, then `HfApi().upload_folder(...)`, printing the
  commit sha to pin. Without `--repo`, generation stays a pure local
  export (req 1).

### `.env.example` (new, mechanical)

- Documents `VITE_EMBEDDING_BASE_URL`.

### Docs (mechanical)

- `src/lib/embeddings/README.md` — new key scheme with the cache tag,
  `## Hosting` (repo layout, revision pinning), `## Re-export runbook`,
  updated "Adding a source".
- `README.md` (root) — Development note on `VITE_EMBEDDING_BASE_URL`.
- `docs/libraries.md` — `## Hugging Face Hub (resolve URLs)`: resolve
  URL shape, CORS + `Content-Length` note, pin-sha advice, no
  range/resume.

### Tests

- `src/lib/embeddings/loader.test.ts` (new, pure, no network):
  `shortHash` determinism / 8-hex shape / distinctness over 200
  synthetic inputs; `hfResolvePrefix` exact string;
  `EMBEDDING_BASE_URL === hfResolvePrefix(HF_DATASET_REPO,
  HF_DATASET_REVISION)`; `EMBEDDING_CACHE_TAG ===
  shortHash(EMBEDDING_BASE_URL)` (req 6).
- `knn-index.test.ts` (extended):
  - R1-B1 adversarial regression: `d=1`, codes `[0,1,5,3,4]`, `m=3`,
    token 0, L2 → ids `[1,3,4]`, dists `[1,3,4]` ascending.
  - `m > K-1` now asserts the exact id set and ascending distances
    (switched cosine → L2: on the line matrix cosine collapses all
    distances to 0, making the order arbitrary).
  - R1-N1: in-memory fake `RowCache` — first `precomputeRows` writes
    3 entries; a second index over the same cache recomputes 0 rows
    and adds no puts.
- `embedding-filter.test.ts` (extended): `predicateSignature` is
  unchanged by `k`/`tau`/`epsilon`/`family`/`maxDistance` and changes
  when any predicate-shaping field changes.
- `preprocessing.test.ts` (extended): `whiten` with a non-identity
  diagonal whitening matrix exercises the matrix-vector product.

## Known limitations and residual risk

- `HF_DATASET_REVISION` is the placeholder `REPLACE_WITH_UPLOAD_SHA`;
  until the human runs the re-export runbook and pastes the sha, the
  default URL 404s. `VITE_EMBEDDING_BASE_URL` (`.env`) overrides in
  the meantime. This is planned, not accidental.
- `EMBEDDING_BASE_URL`/`EMBEDDING_CACHE_TAG` are evaluated at module
  load from `import.meta.env`; the base-URL tests assume the env var
  is unset in the test environment.
- Old IDB entries under the previous key scheme (`source` /
  `<prefix>|<token>`) are orphaned, never cleaned up — harmless but
  they occupy space until the DB is dropped.
- Byte progress lands only in `handleCompute`; `handleNeighbors` /
  `handleUnionGraph` still construct providers without progress
  (out of scope per the plan).
- The exporter always overwrites `<out>/README.md` with the dataset
  card when `--repo` is set (flagged as an open question in the plan;
  considered acceptable).

## Verification

- `npm run check` — 0 errors, 0 warnings.
- `npm run lint` — clean.
- `npm run format` — Prettier reports all files formatted (one test
  file and the worker were reformatted by the pass).
- `npm run test` — 481 passed (41 files), including the new
  `loader.test.ts` and the extended suites.
- Manual browser smoke test of `embedding-knn` fetching from HF with
  progress is deferred to the human until the dataset upload exists
  (runbook in `src/lib/embeddings/README.md`).
