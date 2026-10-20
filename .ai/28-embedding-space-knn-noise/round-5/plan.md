# #28 Round 5 — Remove the GPT-2 output-embedding source; close round-4 nits

- Round: 5
- Addresses: R4-N1, R4-N2, R4-N3; new requirements

## Goal and acceptance criteria

Fold the human-authored requirement below together with the three open
round-4 nits into one revision round on branch
`28-embedding-space-knn-noise`.

Acceptance criteria:

- The GPT-2 output (`lm_head`) embedding source is gone from the
  implementation: absent from `EmbeddingSourceId`, `EMBEDDING_SOURCES`, the
  export script, and the docs. Only `bert-base-uncased` and `gpt2` remain;
  the source picker renders exactly two cards.
- The `embedding-knn` strategy description calls the uniform floor optional.
- The embedding-knn defaults live in one shared constant read by both the UI
  store and the registry fallback, and a test pins the store's defaults.
- `CardPicker` exposes a per-instance accessible name; every picker passes a
  distinct label so the radiogroups are no longer identically named.
- `npm run check`, `lint`, `format`, `test` all green.

## New requirements

Quoted verbatim from the human (`/plan 28 next ...`):

> "Only one small correction: Please remove the gpt2 output embeddings
> (lmhead) from the implementation since they seem to be identical to the
> input embeddings and that is more confusing than helpful."

Folded in: delete the `gpt2-lmhead` source everywhere in the implementation
(type union, registry entry, export script, docs). The already-uploaded
`gpt2-lmhead` artefacts on the HF dataset are left in place — deleting them
needs upload credentials and is out of scope; nothing in the app references
them after this round. No data migration is needed: the store is not
persisted and the orphaned IndexedDB rows are harmless (README
cache-invalidation note).

## Findings and actions

- R4-N1 — `description` says "mixed with uniform noise" while the default is
  `epsilon: 0`. Reword `src/lib/strategies/embedding-knn.ts:65-66` to
  "optionally mixed with uniform noise", mirroring the ε tooltip.
- R4-N2 — the retuned defaults are hand-duplicated in
  `src/lib/stores/embedding.svelte.ts:18-38` and
  `src/lib/strategies/registry.ts:143-155` with no test tying them. Extract a
  single `EMBEDDING_KNN_DEFAULTS` constant, have both read it, and add a store
  test that pins the values.
- R4-N3 — the new source picker is a third `CardPicker` radiogroup whose
  `aria-label` is hardcoded to `"Options"`. Add an `ariaLabel` prop to
  `CardPicker` (default `"Options"`) and pass a distinct label at all four
  call sites (strategy, tokenizer, schedule, embedding source). Labelling only
  the embedding picker would leave the strategy and tokenizer groups
  identically named — the exact defect the finding describes — so all four
  are labelled.

## Files to create / modify

Create:

- `src/lib/strategies/embedding-knn-defaults.ts` — single source of truth:

  ```ts
  import type { EmbeddingKnnConfig } from './embedding-knn.js';

  export const EMBEDDING_KNN_DEFAULTS: Required<EmbeddingKnnConfig> = {
  	sourceId: 'gpt2',
  	preprocess: 'mean-center',
  	metric: 'cosine',
  	tokenClass: 'word-initial',
  	excludeSpecial: true,
  	excludeUnused: true,
  	excludeByteFallback: true,
  	maxDistance: null,
  	k: 20,
  	epsilon: 0,
  	tau: 0.1,
  	family: 'exponential',
  };
  ```

  (Type-only import; no runtime dependency on `embedding-knn.ts`.)
- `src/lib/stores/embedding.test.ts` — pins the store defaults (see Tests).
- `src/lib/embeddings/sources.test.ts` — pins the source set (see Tests).

Modify (removal — the new requirement):

- `src/lib/embeddings/types.ts:12` — drop `| 'gpt2-lmhead'` from
  `EmbeddingSourceId`.
- `src/lib/embeddings/sources.ts:42-55` — delete the `'gpt2-lmhead'` entry.
- `scripts/export_embeddings.py:89-97` — delete the `"gpt2-lmhead"`
  `SourceSpec`; line 58 dataset-card `Sources:` becomes
  `` `bert-base-uncased`, `gpt2` ``.
- `src/lib/embeddings/README.md:72` — "12 files: three sources × four files"
  → "8 files: two sources × four files"; delete the `gpt2-lmhead` bullet at
  lines 110-111.

Modify (nits):

- `src/lib/strategies/embedding-knn.ts:65-66` — description wording.
- `src/lib/stores/embedding.svelte.ts` — initialise each field from
  `EMBEDDING_KNN_DEFAULTS` (L18-38) and use
  `EMBEDDING_KNN_DEFAULTS.maxDistance` for the `params` getter's
  `maxDistance` (L50); add the import.
- `src/lib/strategies/registry.ts:143-155` — replace each literal fallback
  with `EMBEDDING_KNN_DEFAULTS.<field>`; add the import.
- `src/lib/components/CardPicker.svelte` — add `ariaLabel?: string` to
  `Props`, default `'Options'`, bind `aria-label={ariaLabel}` (L63).
- `src/lib/components/EmbeddingSourcePicker.svelte:22` — pass
  `ariaLabel="Embedding source"`.
- `src/lib/components/StrategyPicker.svelte:15` — pass
  `ariaLabel="Noise strategy"`.
- `src/lib/components/TokenizerPicker.svelte:15` — pass
  `ariaLabel="Tokenizer"`.
- `src/lib/components/SchedulePicker.svelte:16` — pass
  `ariaLabel="Noise schedule"`.

## Expected reviewable surface

- Behavioral (small): one registry entry and one union member removed; one
  description string; defaults rerouted through a constant.
- Structural (small): one new constants module, two new tests, one new
  `CardPicker` prop plus four one-line call-site props.
- Mechanical: docs wording, Python `SourceSpec` deletion and card list.
- Risk budget: no sampling math, RNG draw order, worker protocol, or
  dependency changes. The remaining source count drops from three to two and
  is derived everywhere from the registry (picker, tests, loader) — no count
  literals in code.

## Ordered implementation steps

1. Removal: edit `types.ts:12` (drop the union member) and delete the
   `'gpt2-lmhead'` entry in `sources.ts:42-55`.
2. `scripts/export_embeddings.py`: delete the `"gpt2-lmhead"` `SourceSpec`
   (L89-97); update the `Sources:` line in `DATASET_CARD` (L58).
3. `src/lib/embeddings/README.md`: fix the file count (L72) and delete the
   `gpt2-lmhead` note (L110-111).
4. R4-N1: reword the `embedding-knn.ts` `description` (L65-66) to "optionally
   mixed with uniform noise".
5. R4-N2: add `embedding-knn-defaults.ts`; rewire
   `stores/embedding.svelte.ts` and `strategies/registry.ts` to read it.
6. R4-N3: add the `ariaLabel` prop to `CardPicker.svelte`; pass a distinct
   label in `StrategyPicker`, `TokenizerPicker`, `SchedulePicker`,
   `EmbeddingSourcePicker`.
7. Add `src/lib/stores/embedding.test.ts` and
   `src/lib/embeddings/sources.test.ts`.
8. Run the verification commands below in order.

## Tests to add

- `src/lib/embeddings/sources.test.ts`:
  - `Object.keys(EMBEDDING_SOURCES)` equals
    `['bert-base-uncased', 'gpt2']` (pins the removal; fails if lmhead
    returns).
  - `getEmbeddingSource('gpt2-lmhead')` throws.
  - `getEmbeddingSource('gpt2')` returns the `gpt2` entry.
- `src/lib/stores/embedding.test.ts`:
  - `embeddingStore.params` `toEqual` the hardcoded expected defaults object
    (`sourceId: 'gpt2'`, `preprocess: 'mean-center'`, `metric: 'cosine'`,
    `tokenClass: 'word-initial'`, all three exclusions `true`,
    `maxDistance: null`, `k: 20`, `epsilon: 0`, `tau: 0.1`,
    `family: 'exponential'`).
  - `embeddingStore.params` `toEqual` `EMBEDDING_KNN_DEFAULTS` (ties the
    store to the shared constant).
- `src/lib/strategies/registry.test.ts:134-146` — unchanged; still asserts
  the registry fallback values, now sourced from the constant.

## Verification commands

Run in this order, from the repo root:

1. `npm run check`
2. `npm run lint`
3. `npm run format`
4. `npm run test`

## Edge cases, risks, out-of-scope

- The HF dataset still hosts `gpt2-lmhead` files; unreferenced and harmless.
  The exporter's card only changes on the next upload. Out of scope.
- Existing IndexedDB rows keyed by `gpt2-lmhead` are orphaned, not deleted;
  the README documents this as expected. No migration.
- `EmbeddingMeta.source` narrows with the union; no runtime impact (the
  loader validates `meta.source` against the requested source).
- `Required<EmbeddingKnnConfig>` requires `family`; the constant includes it.
- `CardPicker`'s default `ariaLabel` keeps any not-updated caller rendering
  `"Options"`; all in-repo callers are updated.
- No component render tests (node environment, no jsdom): the accessible-name
  change is covered by a human smoke test only, as with the round-4 picker.
- Out of scope: deleting the hosted HF artefacts; renaming the remaining
  "(input)" labels; AC3 hubness/overlap diagnostics (#58/#12); the round-4
  review's open questions (unbudgeted up-front precompute; `InfoTooltip` prop
  doc) — none are on the `- Open findings:` line.
- No open blocking questions.
