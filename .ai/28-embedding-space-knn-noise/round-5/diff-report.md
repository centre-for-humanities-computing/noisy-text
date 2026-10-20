- Round: 5
- Commits: fix(#28): remove gpt2-lmhead source; close round-4 nits (round 5)

# Round 5 — Remove GPT-2 output embeddings; close round-4 nits

This round does two things: it satisfies the human's correction by deleting
the `gpt2-lmhead` (GPT-2 output / `lm_head`) embedding source from the entire
implementation — the type union, the source registry, the Python export
script, and the docs — because it is identical to the `gpt2` input matrix for
base GPT-2 and only added confusion; and it closes the three open round-4
nits: the strategy description now calls the uniform floor optional (R4-N1),
the embedding-knn defaults live in a single `EMBEDDING_KNN_DEFAULTS` constant
shared by the UI store and the registry fallback with tests pinning both
(R4-N2), and `CardPicker` gained an `ariaLabel` prop so all four radiogroups
are distinctly named (R4-N3). No sampling math, RNG draw order, worker
protocol, or dependency changes; the version is untouched (bumped once per
issue in round 1).

## Reading order

1. `src/lib/strategies/registry.ts` — the defaults rewiring is the
   highest-risk hunk: the registry fallback feeds the trajectory cache key,
   so any default drift would silently change sampled trajectories. Values
   are unchanged; only their source moved to `EMBEDDING_KNN_DEFAULTS`.
2. `src/lib/stores/embedding.svelte.ts` — the store's `$state` initialisers
   now read the same constant; same values, new provenance.
3. `src/lib/embeddings/types.ts` and `src/lib/embeddings/sources.ts` — the
   removal itself (union member + registry entry).
4. `src/lib/embeddings/sources.test.ts`,
   `src/lib/stores/embedding.test.ts` — new tests pinning the removal and
   the defaults.
5. `src/lib/components/CardPicker.svelte` plus the four picker wrappers —
   the accessibility fix.
6. `src/lib/strategies/embedding-knn.ts`,
   `scripts/export_embeddings.py`, `src/lib/embeddings/README.md` — wording
   and docs; read last, nothing behavioral.

## Files

### `src/lib/strategies/registry.ts` (modified, behavioral)

The `'embedding-knn'` branch of the defaults fallback now reads
`EMBEDDING_KNN_DEFAULTS.<field>` instead of twelve hand-written literals;
a new import line and a short comment. Every produced value is identical to
before (verified by the unchanged `registry.test.ts:134-146` defaults test).
Maps to R4-N2.

### `src/lib/strategies/embedding-knn-defaults.ts` (new, behavioral surface, zero behavior)

New single source of truth `EMBEDDING_KNN_DEFAULTS:
Required<EmbeddingKnnConfig>` with the exact previously-duplicated values
(`sourceId: 'gpt2'`, `preprocess: 'mean-center'`, `metric: 'cosine'`,
`tokenClass: 'word-initial'`, three exclusions `true`, `maxDistance: null`,
`k: 20`, `epsilon: 0`, `tau: 0.1`, `family: 'exponential'`). Type-only import
of `EmbeddingKnnConfig`, so there is no runtime dependency on
`embedding-knn.ts`. Maps to R4-N2.

### `src/lib/stores/embedding.svelte.ts` (modified, behavioral surface, zero behavior)

Each `$state` field initialiser and the `params` getter's `maxDistance`
now come from `EMBEDDING_KNN_DEFAULTS`; a new import line. Produced `params`
are unchanged. Maps to R4-N2.

### `src/lib/embeddings/types.ts` (modified, behavioral — compile-time)

`EmbeddingSourceId` drops the `'gpt2-lmhead'` member; only
`'bert-base-uncased' | 'gpt2'` remain. `EmbeddingMeta.source` narrows with
it; no runtime impact (the loader already validates `meta.source` against
the requested source). Maps to the new requirement.

### `src/lib/embeddings/sources.ts` (modified, behavioral)

The `'gpt2-lmhead'` entry of `EMBEDDING_SOURCES` is deleted. The source
picker options derive from this registry (`Object.values`), so the UI now
renders exactly two cards with no other change. Maps to the new requirement.

### `src/lib/embeddings/sources.test.ts` (new, test)

Three cases: `Object.keys(EMBEDDING_SOURCES)` equals
`['bert-base-uncased', 'gpt2']` (fails if lmhead ever returns);
`getEmbeddingSource('gpt2')` returns the gpt2 entry with its tokenizer
pairing and dimensions; `getEmbeddingSource` throws for `'gpt2-lmhead'` and
any unknown id. Maps to the new requirement.

### `src/lib/stores/embedding.test.ts` (new, test)

Two cases: `embeddingStore.params` `toEqual` a hardcoded expected-defaults
object, and `toEqual` `EMBEDDING_KNN_DEFAULTS` — the second ties the store
to the shared constant so the R4-N2 duplication cannot silently return.
Imports the `.svelte.ts` store directly (precedent: `graph-store.test.ts`);
no `$app/environment` mock is needed since this store touches no worker.
Maps to R4-N2.

### `src/lib/components/CardPicker.svelte` (modified, behavioral — a11y only)

New optional `ariaLabel` prop (default `'Options'`, preserving the old
markup for any hypothetical unlabelled caller) bound to the radiogroup's
`aria-label`, which was previously hardcoded to `"Options"` on every
instance. Maps to R4-N3.

### `src/lib/components/{EmbeddingSourcePicker,StrategyPicker,TokenizerPicker,SchedulePicker}.svelte` (modified, one line each, behavioral — a11y only)

Each wrapper passes a distinct label: "Embedding source", "Noise strategy",
"Tokenizer", "Noise schedule". Labelling only the new embedding picker would
have left strategy/tokenizer groups identically named — the defect R4-N3
describes — so all four are labelled. Mechanical beyond that.

### `src/lib/strategies/embedding-knn.ts` (modified, docs string)

`description` reworded to "...nearest neighbours, optionally mixed with
uniform noise." to match the `epsilon: 0` default and the ε tooltip. Maps
to R4-N1.

### `scripts/export_embeddings.py` (modified, mechanical)

Deleted the `"gpt2-lmhead"` `SourceSpec` (it exported `lm_head.weight`) and
updated the module docstring's `Sources:` list to two names. The
`--source` argparse choices derive from `SOURCES`, so no other edit was
needed. The next export run simply produces one fewer bundle. Maps to the
new requirement.

### `src/lib/embeddings/README.md` (modified, mechanical)

Hosting section: "12 files: three sources × four files" → "8 files: two
sources × four files". Deleted the Notes bullet explaining the
`gpt2-lmhead`/tied-`wte` caveat (the reason for removal is now in the
round-5 plan and PR thread). The Notes bullet recommending the retuned
defaults stays; `EMBEDDING_KNN_DEFAULTS` matches it.

## Known limitations and residual risk

- The hosted HF dataset (`chcaa/noisy-text-embeddings`) still contains the
  four `gpt2-lmhead` artefacts; they are unreferenced and harmless. Removing
  them needs upload credentials and a revision re-pin — out of scope.
- IndexedDB rows keyed under `gpt2-lmhead` (if any browser fetched them
  before) are orphaned, not deleted; the README's cache-invalidation note
  documents this as expected behavior. No migration.
- The `ariaLabel` change is not covered by an automated test (node
  environment, no jsdom, no component render tests in this repo); it needs
  a human smoke test with a screen reader or the accessibility inspector,
  same as the round-4 picker introduction.
- The default `ariaLabel = 'Options'` in `CardPicker` is a compatibility
  fallback; every in-repo caller now passes an explicit label, so the
  default is effectively dead code kept for safety.
- Local lint note: an untracked `.venv/` Python environment in the working
  tree produces ~79 eslint errors in third-party files under
  `.venv/lib/python3.13/site-packages/torch/...`. It is not gitignored but
  also not tracked; `npx eslint . --ignore-pattern '.venv/'` is clean. CI
  checks out a clean tree and is unaffected.

## Verification results

Run in order, from the repo root:

1. `npm run check` — 0 errors, 0 warnings.
2. `npm run lint` — clean on all tracked files; the only errors are in the
   untracked `.venv/` (see limitations). Verified with
   `npx eslint . --ignore-pattern '.venv/'` → 0 problems.
3. `npm run format` — applied; `npx prettier --check` clean afterwards.
4. `npm run test` — 520 tests passed across 45 files, including the three
   new `sources.test.ts` cases, the two new `embedding.test.ts` cases, and
   the unchanged `registry.test.ts` defaults assertion.