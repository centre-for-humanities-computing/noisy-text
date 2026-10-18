# Plan — Issue #28: Embedding-space kNN noise

- Round: 2
- Addresses: R1-B1, R1-N1, R1-N2, R1-N3, R1-N4, R1-N5; new requirements

## Goal

Round 2 fixes the round-1 blocker in the kNN index, resolves the five
non-blocking findings, and lands HF Hub artefact hosting per the human
requirements block. The `embedding-knn` strategy must fetch its int8
bundles from a pinned revision of the `chcaa/noisy-text-embeddings`
dataset, with automatic cache invalidation when that revision changes.
No `package.json` bump (round 2 of the same issue, same branch/PR #70).

## Acceptance criteria (issue #28)

Unchanged from round 1; round 2 does not move them.

- AC1 — ≥2 embedding sources and ≥2 preprocessings selectable (met).
- AC2 — lazy row computation does not block the UI; progress shown
  (met; round 2 extends progress to the matrix fetch, R1-N3).
- AC3 — hubness + neighbour-overlap diagnostics (deliberately deferred
  to #58/#12; still deferred).
- AC4 — kNN-graph connectivity detected and surfaced (met).

## New requirements

Verbatim from the human (text after `next`):

```text
HF Hub artefact hosting — #28 round 2 (same branch/PR #70, no package.json bump)
Repo: chcaa/noisy-text-embeddings (dataset). Resolve prefix:
https://huggingface.co/datasets/chcaa/noisy-text-embeddings/resolve/<revision>
Bundle layout in the repo (flat, 12 files):
{bert-base-uncased,gpt2,gpt2-lmhead}.{int8.bin,scales.f32.bin,transform.f32.bin,meta.json}
Changes
1. scripts/export_embeddings.py — add --repo chcaa/noisy-text-embeddings (+ optional --revision) that create_repo(repo_type="dataset", exist_ok=True) then HfApi.upload_folder(...) using HF_TOKEN; emit a dataset README.md card. Generation stays usable without upload.
2. src/lib/embeddings/loader.ts
- default EMBEDDING_BASE_URL → https://huggingface.co/datasets/chcaa/noisy-text-embeddings/resolve/<sha> (pinned immutable commit sha, VITE_EMBEDDING_BASE_URL overrides).
- add pure, unit-tested EMBEDDING_CACHE_TAG = shortHash(EMBEDDING_BASE_URL); key the matrices store as ${sourceId}@${EMBEDDING_CACHE_TAG}.
3. src/lib/workers/trajectory.worker.ts — include EMBEDDING_CACHE_TAG in cacheKeyPrefix so the rows store invalidates in lockstep.
4. .env.example (new) — document VITE_EMBEDDING_BASE_URL.
5. Docs — src/lib/embeddings/README.md (repo layout, revision pinning, re-export runbook), root README.md build note, docs/libraries.md (HF-resolve CORS + Content-Length note).
6. Tests — pure tests for the hash/tag and resolve-prefix construction; no network.
Runbook (user-run, documented)
hf auth login → python scripts/export_embeddings.py --source {gpt2,bert-base-uncased,gpt2-lmhead} --out dist/embeddings --repo chcaa/noisy-text-embeddings → copy the returned commit sha into the EMBEDDING_BASE_URL default.
Verification
npm run check → npm run lint → npm run format → npm run test; manual browser smoke test of embedding-knn fetching from HF with progress.
Notes
- Cache invalidation is automatic: any revision/URL change alters EMBEDDING_CACHE_TAG, orphaning old matrices+rows entries (harmless).
- Content-Length is CORS-safelisted, so fetchBytes progress works against the CDN unchanged.
- Range/resumable downloads noted but out of scope.
```

Requirement-to-step mapping (each folds into the steps below):

- Req 1 → exporter `--repo`/`--revision` + dataset card (step 8).
- Req 2 → `loader.ts` base URL, `shortHash`, `EMBEDDING_CACHE_TAG`, keyed
  matrices store (step 2).
- Req 3 → worker `cacheKeyPrefix` includes the tag; couples with R1-N1
  (step 6).
- Req 4 → new `.env.example` (step 10).
- Req 5 → embeddings README, root README, `docs/libraries.md` (step 9).
- Req 6 → `loader.test.ts` pure hash/tag/prefix tests (step 11).
- Runbook → documented in the embeddings README (step 9); user-run.

## Findings and actions

- **R1-B1** (blocker, wrong neighbours) — `knn-index.ts` `topM` never
  maintains the max-heap invariant while filling; `_siftUpMax` starts at
  the wrong index and runs only once. Fix: sift up from the actual
  insertion index on every insert while `size < m`, so the array is a
  valid heap before extraction. Add the review's adversarial regression
  test. (steps 3, 11)
- **R1-N1** (RowCache never wired) — inject an `idbRowCache` adapter and
  pass `cache` + `cacheKeyPrefix` when the worker builds the index, so
  `precomputeRows` reads/writes the `rows` store. Coupled with req 3.
  Add a pure in-memory RowCache hit/miss test. (steps 1, 3, 6, 11)
- **R1-N2** (cache key too broad) — build the provider cache key from a
  stable predicate signature (token-class + the three exclusion flags)
  only; drop `k`, `tau`, `epsilon`, `family`, `maxDistance`. Extract
  `predicateSignature` and unit-test it. (steps 4, 6, 11)
- **R1-N3** (fetch progress dropped) — pass the worker's `onProgress`
  through to `loadEmbedding(sourceId, onProgress)` so byte progress is
  reported under the `'preparing'` phase. (step 6)
- **R1-N4** (dead code) — remove the unused `_pre` scratch buffer in
  `knn-index.ts` and the unused `embeddingStore.status` / `markReady()`
  (plus its `+page.svelte` call and the now-unused `browser` import).
  (steps 3, 7)
- **R1-N5** (soundness contract) — amend the `DistanceModel` doc in
  `distance-model.ts` to document the kNN exception (fixed top-$M$ set,
  valid only under the kNN interpretation; callers must use
  $R_{\max} = \infty$). (step 5)

## Files to create

### `.env.example` (new)

Documents the runtime override; `.gitignore` already un-ignores it
(`!.env.example`):

```dotenv
# Base URL for the hosted embedding bundles used by the `embedding-knn`
# strategy. Defaults to the pinned HF dataset revision in
# src/lib/embeddings/loader.ts. Override (no trailing slash) to point at
# a local or alternative host.
VITE_EMBEDDING_BASE_URL=https://huggingface.co/datasets/chcaa/noisy-text-embeddings/resolve/<revision-sha>
```

### `src/lib/embeddings/loader.test.ts` (new)

Pure tests (no network, no IDB): `shortHash` determinism/distinctness/
8-hex shape; `hfResolvePrefix` exact string; `EMBEDDING_BASE_URL`
matches the HF resolve prefix; `EMBEDDING_CACHE_TAG ===
shortHash(EMBEDDING_BASE_URL)`.

## Files to modify

### `src/lib/embeddings/loader.ts`

- Add exports (above `EMBEDDING_BASE_URL`):

```ts
/** HF dataset repo hosting the exported bundles (#28 round 2). */
export const HF_DATASET_REPO = 'chcaa/noisy-text-embeddings';
/** Pinned commit sha; replace with the sha printed by the exporter
 * (see README runbook). Overridable at build via
 * VITE_EMBEDDING_BASE_URL. */
export const HF_DATASET_REVISION = 'REPLACE_WITH_UPLOAD_SHA';

/** Build an HF `resolve` prefix for a dataset repo at a revision. */
export function hfResolvePrefix(repo: string, revision: string): string {
	return `https://huggingface.co/datasets/${repo}/resolve/${revision}`;
}

/** FNV-1a 32-bit hash of a string → 8 lowercase hex chars. */
export function shortHash(input: string): string {
	let h = 2166136261;
	for (let i = 0; i < input.length; i++) {
		h ^= input.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return (h >>> 0).toString(16).padStart(8, '0');
}
```

- Replace the default at `loader.ts:28-30`:

```ts
export const EMBEDDING_BASE_URL: string =
	(import.meta.env.VITE_EMBEDDING_BASE_URL as string | undefined) ??
	hfResolvePrefix(HF_DATASET_REPO, HF_DATASET_REVISION);

/** Cache tag: changes whenever the base URL (revision) changes. */
export const EMBEDDING_CACHE_TAG: string = shortHash(EMBEDDING_BASE_URL);
```

- Key the `matrices` store by `${sourceId}@${EMBEDDING_CACHE_TAG}`:
  - read at `loader.ts:118` → `idbGet<CachedBundle>(MATRIX_STORE,
    `${sourceId}@${EMBEDDING_CACHE_TAG}`)`.
  - write at `loader.ts:175` → `idbPut(MATRIX_STORE,
    `${sourceId}@${EMBEDDING_CACHE_TAG}`, bundle)`.
- Update the file doc comment: default is now the pinned HF resolve
  prefix, not a placeholder domain.

### `src/lib/embeddings/idb.ts`

Add a `RowCache` adapter over the `rows` store (type-only import, no
runtime cycle):

```ts
import type { RowCache } from './knn-index.js';

/** RowCache backed by the `rows` object store (no-op without IDB). */
export const idbRowCache: RowCache = {
	get: (key) => idbGet(ROW_STORE, key),
	put: (key, value) => idbPut(ROW_STORE, key, value),
};
```

Place after `idbPut`. `ROW_STORE` stays module-private.

### `src/lib/embeddings/knn-index.ts`

- Delete the unused `_pre` field (`:66`) and its allocation (`:89`).
- Fix `topM` heap maintenance (`:112-116`): sift up from the actual
  insertion index on every insert while the heap is filling:

```ts
if (size < this.m) {
	heapIds[size] = j;
	heapDists[size] = dist;
	this._siftUpMax(heapDists, heapIds, size);
	size++;
} else if (dist < heapDists[0]!) {
	heapDists[0] = dist;
	heapIds[0] = j;
	this._siftDownMax(heapDists, heapIds, size);
}
```

- Change `_siftUpMax` (`:161-174`) to take an explicit start index:

```ts
/** Sift the element at `start` up to restore the max-heap invariant. */
private _siftUpMax(dists: Float32Array, ids: Int32Array, start: number): void {
	let i = start;
	while (i > 0) {
		const parent = (i - 1) >> 1;
		if (dists[i]! <= dists[parent]!) return;
		// swap dists[i] ↔ dists[parent], ids[i] ↔ ids[parent]
		i = parent;
	}
}
```

- Update the class doc note that the `RowCache` "is consulted in
  `precomputeRows`" to state it is injected by the worker (now true).

### `src/lib/embeddings/embedding-filter.ts`

Add:

```ts
/** Stable signature of the predicate-shaping fields (for cache keys). */
export function predicateSignature(
	cfg: Pick<
		EmbeddingKnnConfig,
		'tokenClass' | 'excludeSpecial' | 'excludeUnused' | 'excludeByteFallback'
	>,
): string {
	return `${cfg.tokenClass}:${cfg.excludeSpecial}:${cfg.excludeUnused}:${cfg.excludeByteFallback}`;
}
```

### `src/lib/strategies/distance-model.ts`

In the `DistanceModel` doc block (`:14-42`), add an explicit exception
note: kNN-backed models (e.g. `EmbeddingDistanceModel`) return a fixed
top-$M$ neighbourhood rather than a radius-bounded superset; such models
must be wrapped with $R_{\max} = \infty$ and their `candidates` are not a
sound superset in the radius sense. Doc-only change.

### `src/lib/workers/trajectory.worker.ts`

- Imports: add `EMBEDDING_CACHE_TAG`, `idbRowCache` to the
  `../embeddings/index.js` import; add `predicateSignature` to the
  `embedding-filter.js` import.
- In `ensureEmbeddingProvider` (`:131-173`):
  - replace `const cfgHash = JSON.stringify(cfg);` and the cache key
    (`:149-150`) with:

```ts
const cacheKey = `embedding:${sourceId}:${preprocess}:${metric}:${predicateSignature(cfg)}`;
```

  - pass progress through: `const { matrix, transform, meta } = await
    loadEmbedding(sourceId, onProgress);`
  - build the row-cache prefix and inject it (`:166`):

```ts
const rowPrefix = `${sourceId}|${preprocess}|${metric}|${NEIGHBOR_STORE_LIMIT}@${EMBEDDING_CACHE_TAG}`;
const index = new EmbeddingKnnIndex(matrix, transform, preprocess, metric, NEIGHBOR_STORE_LIMIT, {
	cache: idbRowCache,
	cacheKeyPrefix: rowPrefix,
});
```

  - update the `_embeddingCache` doc comment (`:105-109`) to drop the `k`
    from the key description.

### `src/lib/stores/embedding.svelte.ts`

Remove `EmbeddingStatus` (`:5`), the `status` field (`:42-43`),
`markReady()` (`:63-67`), and the now-unused `browser` import (`:1`).
Keep `params` unchanged.

### `src/routes/+page.svelte`

Remove `embeddingStore.markReady();` (`:393`). Nothing else changes.

### `src/lib/embeddings/index.ts`

Re-export the new loader/idb symbols:

```ts
export {
	EMBEDDING_BASE_URL,
	EMBEDDING_CACHE_TAG,
	HF_DATASET_REPO,
	HF_DATASET_REVISION,
	hfResolvePrefix,
	shortHash,
	loadEmbedding,
} from './loader.js';
export { hasIndexedDb, idbGet, idbPut, idbRowCache } from './idb.js';
```

(Keep the existing type re-exports.)

### `scripts/export_embeddings.py`

- Imports (`:33`): `from huggingface_hub import HfApi, create_repo,
  hf_hub_download`.
- Update the module docstring usage to show `--repo`.
- Add a module-level dataset card string, e.g.:

```python
DATASET_CARD = """\
---
license: apache-2.0
pretty_name: noisy-text embedding bundles
tags:
- embeddings
- int8
- quantization
---
# noisy-text embedding bundles

Quantized token-embedding bundles for the `embedding-knn` noise strategy
of the noisy-text playground (#28). Flat layout, four files per source:

- `<source>.int8.bin`        int8 codes, row-major, K x d
- `<source>.scales.f32.bin`  per-row scales, length K
- `<source>.transform.f32.bin`  mean / PCA / eigenvalue / whitening blob
- `<source>.meta.json`       header

Sources: `bert-base-uncased`, `gpt2`, `gpt2-lmhead`.
Regenerate with `scripts/export_embeddings.py` in the noisy-text repo.
"""
```

- Add args after `--out` (`:136`):

```python
parser.add_argument("--repo", default=None, help="HF dataset repo id to upload to")
parser.add_argument("--revision", default=None, help="target revision/branch for the upload")
```

- After the size-report loop (`:171-173`), add:

```python
if args.repo:
    with open(os.path.join(args.out, "README.md"), "w", encoding="utf-8") as f:
        f.write(DATASET_CARD)
    token = os.environ.get("HF_TOKEN")
    create_repo(args.repo, repo_type="dataset", exist_ok=True, token=token)
    commit = HfApi().upload_folder(
        repo_id=args.repo,
        repo_type="dataset",
        folder_path=args.out,
        revision=args.revision,
        token=token,
        commit_message=f"Upload {args.source} embedding bundle",
    )
    print(f"uploaded to {args.repo} @ {commit.oid}")
    print("pin this sha: HF_DATASET_REVISION in src/lib/embeddings/loader.ts")
```

Generation without `--repo` stays a pure local export.

### `src/lib/embeddings/README.md`

- IDB key scheme: `matrices` key `<source>@<EMBEDDING_CACHE_TAG>`;
  `rows` key `<source>|<preprocess>|<metric>|<m>@<tag>|<token>`.
- New `## Hosting` section: HF dataset repo, the
  `.../resolve/<revision>/<file>` layout (flat, 12 files), revision
  pinning, and that `VITE_EMBEDDING_BASE_URL` overrides the default.
- New `## Re-export runbook` section:
  `hf auth login`; run the exporter once per source with
  `--out dist/embeddings --repo chcaa/noisy-text-embeddings`; copy the
  printed commit sha into `HF_DATASET_REVISION` (or set
  `VITE_EMBEDDING_BASE_URL`).
- Update "Adding a source" step 3 (host under the HF repo, then pin).

### `README.md` (root)

Under `## Development`, add a short note: the `embedding-knn` strategy
reads `VITE_EMBEDDING_BASE_URL` (copy `.env.example` to `.env`);
defaults to the pinned HF dataset revision in
`src/lib/embeddings/loader.ts`.

### `docs/libraries.md`

Add a `## Hugging Face Hub (resolve URLs)` section:

- Artefacts download from
  `https://huggingface.co/datasets/<repo>/resolve/<revision>/<file>`.
- The `resolve` endpoint sets permissive CORS headers and a
  `Content-Length`, which is CORS-safelisted, so `fetchBytes`
  (`loader.ts:54`) streams byte progress unchanged.
- Pin an immutable commit sha (not `main`) for content-addressed URLs.
- Range/resumable downloads are not used (out of scope).

## Expected reviewable surface

- Behavioral, high risk: `knn-index.ts` topM heap fix; `trajectory.worker.ts`
  provider key + row-cache injection; `loader.ts` base URL + cache tag.
- Behavioral, low risk: `loader.ts` matrices key, `idb.ts` adapter,
  `embedding-filter.ts` `predicateSignature`, `distance-model.ts` doc.
- Mechanical: `.env.example`, `index.ts` barrel, store `status` removal,
  `+page.svelte` one-line removal, READMEs, `docs/libraries.md`,
  `scripts/export_embeddings.py` (not run by CI).
- New tests: `loader.test.ts` + extensions to `knn-index.test.ts`,
  `embedding-filter.test.ts`, `preprocessing.test.ts`.
- Reviewer budget: `knn-index.ts` heap and `loader.ts`/worker cache keying
  are the core; the rest is small wiring and docs.

## Ordered implementation steps

1. `idb.ts`: add `idbRowCache`; `index.ts`: re-export it.
2. `loader.ts`: `HF_DATASET_REPO`/`HF_DATASET_REVISION`/`hfResolvePrefix`/
   `shortHash`/`EMBEDDING_CACHE_TAG`; matrices key uses the tag; update
   the doc comment.
3. `knn-index.ts`: remove `_pre`; fix `topM` + `_siftUpMax`.
4. `embedding-filter.ts`: add `predicateSignature`.
5. `distance-model.ts`: add the kNN exception note.
6. `trajectory.worker.ts`: narrowed provider key, `loadEmbedding`
   progress, row-cache injection with the tag prefix.
7. `embedding.svelte.ts` + `+page.svelte`: remove dead `status`/
   `markReady`.
8. `scripts/export_embeddings.py`: `--repo`/`--revision`, dataset card,
   upload.
9. Docs: embeddings README, root README, `docs/libraries.md`.
10. `.env.example`.
11. Tests: new `loader.test.ts`; extend `knn-index.test.ts`,
    `embedding-filter.test.ts`, `preprocessing.test.ts`.
12. Run the verification commands in order.

## Tests to add

- `src/lib/embeddings/loader.test.ts` (new, pure): `shortHash`
  determinism, distinctness, 8-hex; `hfResolvePrefix` exact output;
  `EMBEDDING_BASE_URL` starts with the HF dataset resolve prefix;
  `EMBEDDING_CACHE_TAG === shortHash(EMBEDDING_BASE_URL)`.
- `src/lib/embeddings/knn-index.test.ts` (extend):
  - R1-B1 adversarial order: `d=1`, codes `[0,1,5,3,4]`, scales all `1`,
    `m=3`, token `0`, L2 → `ids === [1,3,4]`, `dists === [1,3,4]`,
    ascending.
  - `m > K-1`: assert the exact id set and ascending order (not just
    length).
  - R1-N1: in-memory fake `RowCache` (`Map`); first
    `precomputeRows` writes entries; a second index over the same fake
    serves them (assert cache hits / no rewrites).
- `src/lib/strategies/embedding-filter.test.ts` (extend): R1-N2 —
  `predicateSignature` is unchanged by `k`/`tau`/`epsilon`/`family`/
  `maxDistance` and changes when an exclusion toggles.
- `src/lib/embeddings/preprocessing.test.ts` (extend): `whiten` with a
  non-identity (diagonal) whitening matrix exercises the matrix-vector
  product.

## Verification commands (in order)

1. `npm run check`
2. `npm run lint`
3. `npm run format`
4. `npm run test`

Manual (human, post-upload): run the re-export runbook, set
`HF_DATASET_REVISION`, then smoke-test `embedding-knn` in the browser and
confirm the fetch shows progress.

## Edge cases and risks

- **Placeholder revision:** the committed default is
  `HF_DATASET_REVISION = 'REPLACE_WITH_UPLOAD_SHA'`; until the human
  pastes the upload sha the default URL 404s. `VITE_EMBEDDING_BASE_URL`
  (via `.env`) overrides meanwhile. Documented; not blocking `/implement`.
- **The HF repo already exists** (`chcaa/noisy-text-embeddings`, public)
  but holds only `.gitattributes` + `README.md`; the first upload adds the
  bundles and moves `main` to a new sha.
- **`upload_folder` uploads the whole `--out`:** running the three
  sources into one `dist/embeddings` accumulates all 12 files; separate
  out-dirs also union to 12 in the repo. It never deletes existing files.
- **Cache invalidation:** any URL/revision change changes
  `EMBEDDING_CACHE_TAG`, orphaning the old `matrices` + `rows` keys
  (harmless).
- **Prettier ignores `.py`** (no parser); the exporter is not
  format-checked.
- **Node has no `indexedDB`:** `idbRowCache` degrades to a no-op through
  the existing guards; tests use an in-memory fake.
- **`EMBEDDING_BASE_URL` is evaluated at module load** from
  `import.meta.env`; tests assume the env var is unset.
- **Removing `embeddingStore.status`/`markReady`** also removes the
  `browser` import if it becomes unused; confirm no other reader exists.

## Out of scope (this round)

- Range/resumable downloads.
- AC3 hubness / neighbour-overlap diagnostics (#58/#12).
- Byte progress in `handleNeighbors` / `handleUnionGraph` (only
  `handleCompute` forwards `onProgress`).
- Review "missing test" gaps not tied to a finding (e.g. `classifyTokens`
  GPT-2 punctuation / `i === 0`, the full `loadEmbedding`/`idb.ts` path).
- `package.json` bump (round 2).

## Open questions

- Confirm the dataset card license tag (`apache-2.0`, matching the
  existing repo card) and that always overwriting `<out>/README.md` is
  acceptable.
- Confirm the placeholder constant name/value
  (`HF_DATASET_REVISION = 'REPLACE_WITH_UPLOAD_SHA'`).
