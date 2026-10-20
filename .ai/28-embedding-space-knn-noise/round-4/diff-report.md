- Round: 4
- Commits: fix(#28): retune defaults, enforce warm-up budget, unify tooltips and source picker (round 4)

Round 4 is the revision round for the round-3 review (R3-N1, R3-N2) plus
the human follow-ups on discoverability and defaults. It fixes the two
open findings: the warm-up BFS time budget is now enforced *within* a
batch — `precomputeRows` takes an optional `deadline` and stops at the
next chunk boundary, so the 15 s budget holds mid-batch instead of only
between BFS rounds (R3-N1) — and the memoized-skip path in
`precomputeRows` now reports progress, so a fully-cached batch still
emits its final `[total, total]` progress event (R3-N2). On the UX side,
every advanced parameter across the Lexical, Char-overlap, Embedding,
and Schedule panels gets an `InfoTooltip` backed by a new
`param-help.ts` copy module; the duplicate Source `<select>` in the
Advanced panel is replaced by a quiet `EmbeddingSourcePicker` card shown
next to the strategy pickers (edit mode and explore strip); the
embedding source metadata gains `plainName`/`gloss`/`tooltip` fields;
the strategy card is renamed "Drift by language model" and the ε copy is
softened to "optional uniform floor". Finally the `embedding-knn`
defaults are retuned to `preprocess: 'mean-center'`, `tokenClass:
'word-initial'`, `k: 20`, `tau: 0.1` in both the UI store and the
registry fallback. No `package.json` bump (same issue, round 4; the
round-1 bump stands).

## Reading order

1. `src/lib/embeddings/knn-index.ts` — highest risk. The `deadline`
   break and the progress-on-skip change the behaviour of a hot,
   correctness-sensitive loop; the guarantees (chunk-boundary stopping,
   no synthetic final call on early break, unchanged scan order) are
   what the worker's budget and progress logic rely on. Behavioral.
2. `src/lib/workers/trajectory.worker.ts` — deadline construction and
   threading into `precomputeRows`; the BFS while-condition now shares
   the same deadline. Behavioral.
3. `src/lib/stores/embedding.svelte.ts` +
   `src/lib/strategies/registry.ts` — retuned defaults; the registry
   fallback and the store must agree or the UI shows one thing and a
   reset computes with another. Behavioral (output-affecting for new
   sessions).
4. `src/lib/components/param-help.ts` (new) — single source of truth
   for all advanced-param tooltips. Content-only but load-bearing for
   copy consistency.
5. `src/lib/components/EmbeddingSourcePicker.svelte` (new) +
   `src/routes/+page.svelte` + `src/lib/components/EmbeddingParams.svelte`
   — the picker move; check the edit/explore placement and that the
   Advanced panel no longer duplicates the control. Behavioral.
6. `src/lib/embeddings/sources.ts` + `types.ts` — new display fields.
   Behavioral (content).
7. Param panel tooltips: `LexicalParams.svelte`,
   `CharOverlapParams.svelte`, `EmbeddingParams.svelte`,
   `ScheduleParams.svelte`, and `kernel-help.ts` (caption softening +
   two new tooltips). Mostly mechanical wiring; `kernel-help.ts` copy
   is behavioral.
8. `src/lib/strategies/embedding-knn.ts` — plainName rename + ε copy.
9. Tests: `param-help.test.ts` (new), `kernel-help.test.ts`,
   `InfoTooltip.test.ts`, `knn-index.test.ts`, `registry.test.ts`.
10. Docs: `src/lib/strategies/README.md` (prettier also re-aligned the
    whole table — mechanical), `src/lib/embeddings/README.md`.

## Changed files

### `src/lib/embeddings/knn-index.ts` (behavioral)

- `precomputeRows` gains an optional third parameter
  `deadline?: number` (a `performance.now()` timestamp). It is checked
  at the top of each chunk (`performance.now() >= deadline` → break),
  so the worst-case overrun is one chunk. Optional, so all existing
  call sites compile unchanged.
- Memoized rows (`this._topM.has(token)`) now call
  `onProgress?.(i + 1, total)` before `continue` — this is what
  restores the final `[total, total]` event on a fully-cached batch
  (R3-N2).
- No synthetic final progress call is emitted when the deadline breaks
  early; the class doc documents both the best-effort overrun bound and
  the no-final-call-on-break behaviour.

### `src/lib/workers/trajectory.worker.ts` (behavioral)

- The warm-up BFS now computes `const deadline = warmStart +
  WARMUP_TIME_BUDGET_MS` once and (a) uses
  `performance.now() < deadline` in the while-condition (same semantics
  as the old `performance.now() - warmStart < WARMUP_TIME_BUDGET_MS`,
  just expressed against a shared deadline) and (b) passes `deadline`
  into `precomputeRows` so the budget is also enforced *between chunks
  inside a batch*, not only between BFS rounds (R3-N1). The module
  comment on the BFS now states this explicitly.

### `src/lib/components/param-help.ts` (new)

- Module holding one `ParamHelp` export per advanced parameter:
  `MAX_DISTANCE_TOOLTIP`, `MIN_SIMILARITY_TOOLTIP`, `MULTISET_TOOLTIP`,
  `PREPROCESSING_TOOLTIP`, `METRIC_TOOLTIP`, `TOKEN_CLASS_TOOLTIP`,
  `EXCLUDE_SPECIAL_TOOLTIP`, `EXCLUDE_UNUSED_TOOLTIP`,
  `EXCLUDE_BYTE_FALLBACK_TOOLTIP`, `RATE_MULTIPLIER_TOOLTIP`. Copy is
  verbatim from the plan.

### Param panels (mechanical wiring)

- `LexicalParams.svelte`, `CharOverlapParams.svelte`,
  `EmbeddingParams.svelte`, `ScheduleParams.svelte`: each advanced
  param label now wraps an `InfoTooltip` fed from `param-help.ts` (or
  `kernel-help.ts` for kernel params). No prop/logic changes otherwise.

### `src/lib/components/kernel-help.ts` (behavioral copy)

- `KERNEL_CAPTION` softened: the trailing clause is now "setting Floor
  ε above 0 keeps every token reachable" (the old wording implied the
  floor is always on).
- New `TOPK_TOOLTIP` and `EPSILON_TOOLTIP` (`HelpCopy` with text +
  KaTeX math), copy verbatim from the plan.

### `src/lib/components/EmbeddingSourcePicker.svelte` (new)

- Quiet card-style picker wrapping the existing `CardPicker`
  primitives: props `value`, `disabled`, `onchange`; options derived
  from `Object.values(EMBEDDING_SOURCES)` and rendered from the new
  `plainName`/`gloss` metadata with the tooltip attached.

### `src/routes/+page.svelte` (behavioral)

- The picker is rendered in the edit-mode `.edit-pickers` row and in
  the explore control strip, both gated on
  `strategyStore.currentId === 'embedding-knn'`; `disabled` while
  `tokenizerStore.status !== 'ready'`; `onchange` writes
  `embeddingStore.sourceId`.
- `EmbeddingParams` no longer receives `sourceId` /
  `onsourcechange` props (the duplicate Advanced Source select is
  gone). The `EMBEDDING_SOURCES` import is kept — it is still used by
  the tokenizer-alignment `$effect`.

### `src/lib/components/EmbeddingParams.svelte` (behavioral)

- Source `<select>` and the `sourceId`/`onsourcechange` props removed;
  `EMBEDDING_SOURCES` import dropped. Remaining params unchanged apart
  from tooltip wiring.

### `src/lib/embeddings/types.ts` + `sources.ts` (behavioral, content)

- `EmbeddingSourceInfo` gains `plainName`, `gloss`, `tooltip`; the
  three entries are populated with the dictated copy: "BERT (input)",
  "GPT-2 (input)", "GPT-2 (output)".

### `src/lib/stores/embedding.svelte.ts` + `src/lib/strategies/registry.ts` (behavioral)

- Retuned defaults in both places so store and registry fallback agree:
  `preprocess: 'mean-center'`, `tokenClass: 'word-initial'`, `k: 20`,
  `tau: 0.1`. All other defaults (`sourceId: 'gpt2'`,
  `metric: 'cosine'`, `epsilon: 0`, `family: 'exponential'`,
  `exclude*` true, `maxDistance: null`) unchanged.

### `src/lib/strategies/embedding-knn.ts` (behavioral, copy)

- Strategy card `plainName` "Drift by meaning" → "Drift by language
  model"; the floor-ε description reworded to the "optional uniform
  floor" copy.

### Tests

- `src/lib/components/param-help.test.ts` (new): every export is
  non-empty text, and each `math` string renders through
  `katex.renderToString(..., { throwOnError: false })` without
  producing a `katex-error`.
- `src/lib/components/kernel-help.test.ts`: `COPY` now also covers
  `TOPK_TOOLTIP` and `EPSILON_TOOLTIP` (non-empty + KaTeX-render
  assertions come from the shared loop).
- `src/lib/components/InfoTooltip.test.ts`: asserts the new
  `EmbeddingSourceInfo` fields exist on all `EMBEDDING_SOURCES` entries.
- `src/lib/embeddings/knn-index.test.ts`: two new cases —
  (a) a memoized-skip progress test that runs `precomputeRows` twice
  over the same tokens and asserts the second call ends with the final
  `[total, total]` call; (b) a `deadline = 0` test asserting the loop
  stops before computing anything.
- `src/lib/strategies/registry.test.ts`: the embedding-knn defaults
  test is renamed to "defaults for embedding-knn use the retuned
  params" and asserts the new values.

### Docs

- `src/lib/strategies/README.md`: embedding-knn row now says "plus an
  optional uniform floor". Prettier re-aligned the whole table
  (mechanical whitespace from the longer line).
- `src/lib/embeddings/README.md`: a recommended-defaults bullet at the
  top of `## Notes` records the retuned defaults.

## Known limitations and residual risk

- The deadline is best-effort by design: one chunk of overrun is
  possible, and rows already in flight within a chunk still complete.
  The plan accepts this; nothing mid-chunk is cancelled.
- When the deadline breaks, `precomputeRows` returns early with fewer
  rows warmed; the BFS then simply proceeds with a smaller frontier on
  the next round — correct, just possibly slower on cold caches.
- Out of scope (per plan): AC3 diagnostics, aggregate progress totals
  across batches, and removing the now-unused `k` parameter on
  `ensureEmbeddingProvider`.
- The picker gating depends on `strategyStore.currentId ===
  'embedding-knn'` in two places; if a third surface ever needs the
  picker it should reuse the same condition.
- The local `npx eslint .` reports 79 errors — all from the untracked
  `.venv/` Python environment (not in CI, not part of this diff); zero
  errors in `src/`. Because `.prettierignore` lacks a `.venv` entry,
  the full-repo `npm run lint`/`npm run format` are slow locally;
  verification used targeted prettier runs plus `--check src` instead.

## Verification

- `npm run check` — 0 errors, 0 warnings.
- `npm run test` — 515 passed (43 files), up from 488: +10 param-help
  copy/math tests, +2 kernel-help tooltip cases, +1
  InfoTooltip/EMBEDDING_SOURCES case, +2 knn-index cases (memoized
  progress, deadline), registry defaults test renamed/re-asserted.
- Prettier — `npx prettier --check src` clean; all changed files were
  reformatted with `npx prettier --write` before commit.
- Lint — `npx eslint src` clean (see limitations for the `.venv`
  noise).
- No `package.json` bump: revision round, bump already happened in
  round 1.
