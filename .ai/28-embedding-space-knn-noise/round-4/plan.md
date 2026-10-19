# #28 Round 4 — Embedding-knn defaults, settings help, and model selection

- Round: 4
- Addresses: R3-N1, R3-N2; new requirements

## Goal and acceptance criteria

Fold the human-authored requirements (below) together with the two open
round-3 findings into one revision round on branch
`28-embedding-space-knn-noise`.

Acceptance criteria:

- Every advanced parameter control across the Lexical, Char-overlap,
  Embedding and Schedule panels has a plain-language `InfoTooltip`
  (τ/Family/kernel already do).
- The embedding model/source is selectable from the edit screen before
  "Noise it" via a quiet card picker, and the duplicate Advanced `Source`
  dropdown is gone.
- The embedding strategy card reads `Drift by language model`.
- `embedding-knn` defaults are `preprocess: 'mean-center'`,
  `tokenClass: 'word-initial'`, `k: 20`, `tau: 0.1` in both the store and
  the registry fallback, with everything else unchanged.
- `registry.test.ts` asserts the new defaults; `precomputeRows` always
  emits a final `[total, total]` progress call; the warm-up BFS respects
  `WARMUP_TIME_BUDGET_MS` even mid-batch.
- Docs updated; `npm run check`, `lint`, `format`, `test` all green.

## New requirements

Quoted verbatim from the human (`/plan 28 next ...`):

> "every setting needs to be explained to the user like the settings for
> other things"
>
> "there needs to be a way to select WHICH embedding model you use before
> clicking Noise it - currently you're locked into gpt2"
>
> "the embedding strategy card [must be] renamed to 'Drift by language
> model' instead of 'Drift by meaning'"
>
> "Also fold in this plan: Plan: retune embedding-knn defaults + clarify
> UI guidance" — with sub-points:
> 1. New defaults in `src/lib/stores/embedding.svelte.ts` and the fallback
>    in `src/lib/strategies/registry.ts`: `preprocess` `'none'` →
>    `'mean-center'`, `tokenClass` `'any'` → `'word-initial'`, `k` 50 → 20,
>    `tau` 1.0 → 0.1. `sourceId`, `metric`, `epsilon`, `family`,
>    `exclude*` unchanged (gpt2, cosine, 0, exponential, all true).
> 2. Update `src/lib/strategies/registry.test.ts:134-143` (currently
>    asserts `tokenClass === 'any'`) to the new defaults and rename the test.
> 3. UI guidance: reword `src/lib/strategies/embedding-knn.ts:74-75`
>    (ε "keeps the process connected" but default is 0) to describe ε as
>    optional; soften `src/lib/components/kernel-help.ts:20`
>    `KERNEL_CAPTION` "Floor ε keeps every token reachable" to note it
>    applies when ε > 0; add `InfoTooltip`s on Preprocessing, Token class
>    and Top-k in `EmbeddingParams.svelte`, reusing
>    `PREPROCESSINGS[*].description`; new copy in a small help module.
> 4. Docs: `src/lib/strategies/README.md` row "plus uniform floor" →
>    "optional uniform floor"; add a one-line "recommended defaults" note
>    to `src/lib/embeddings/README.md`.

Human clarifications (already agreed): "every setting explained" means
**all advanced params** across all four panels; model selection is a
**card picker in edit mode**, with the Advanced `Source` dropdown removed.

## Findings and actions

- R3-N1 — warm-up BFS time budget not enforced within a batch. Add a
  `deadline` to `EmbeddingKnnIndex.precomputeRows` that breaks between
  chunks, and check the deadline in the worker's frontier expansion and
  before/after each batch. Files: `src/lib/embeddings/knn-index.ts`
  (333-371), `src/lib/workers/trajectory.worker.ts` (356-388).
- R3-N2 — `precomputeRows` skips the final `[total, total]` progress call
  on the memoized `continue` path. Emit `onProgress?.(i + 1, total)`
  before the `continue` at `knn-index.ts:350`. (Do not emit a synthetic
  final call after an early deadline break — that would misreport work
  not done.)

## Files to create / modify

Create:

- `src/lib/components/param-help.ts` — strategy-specific control copy.
  Exports `interface ParamHelp { readonly text: string; readonly math?: string }`
  and constants: `MAX_DISTANCE_TOOLTIP`, `MIN_SIMILARITY_TOOLTIP`,
  `MULTISET_TOOLTIP`, `PREPROCESSING_TOOLTIP`, `METRIC_TOOLTIP`,
  `TOKEN_CLASS_TOOLTIP`, `EXCLUDE_SPECIAL_TOOLTIP`,
  `EXCLUDE_UNUSED_TOOLTIP`, `EXCLUDE_BYTE_FALLBACK_TOOLTIP`,
  `RATE_MULTIPLIER_TOOLTIP`.
- `src/lib/components/param-help.test.ts` — sibling test (see Tests).
- `src/lib/components/EmbeddingSourcePicker.svelte` — thin wrapper over
  `CardPicker` (`variant="quiet"`), props
  `{ value: EmbeddingSourceId; disabled: boolean; onchange: (id: EmbeddingSourceId) => void }`;
  options built from `Object.values(EMBEDDING_SOURCES)` mapped to
  `{ id, label, plainName, gloss, tooltip }`.

Modify (copy):

- `src/lib/components/kernel-help.ts` — soften `KERNEL_CAPTION`; add
  `TOPK_TOOLTIP: HelpCopy` and `EPSILON_TOOLTIP: HelpCopy`.
- `src/lib/components/kernel-help.test.ts` — add both to `COPY`.
- `src/lib/components/LexicalParams.svelte` — tooltips on Max distance
  (`MAX_DISTANCE_TOOLTIP`), Top-k (`TOPK_TOOLTIP`), Floor ε
  (`EPSILON_TOOLTIP`).
- `src/lib/components/CharOverlapParams.svelte` — tooltips on Min
  similarity (`MIN_SIMILARITY_TOOLTIP`), Top-k (`TOPK_TOOLTIP`),
  Floor ε (`EPSILON_TOOLTIP`), Multiset (`MULTISET_TOOLTIP`).
- `src/lib/components/ScheduleParams.svelte` — import `InfoTooltip` +
  `RATE_MULTIPLIER_TOOLTIP`; tooltip on Rate multiplier λ.
- `src/lib/components/EmbeddingParams.svelte` — remove the Source
  `<select>` (62-73) and its `sourceId` / `onsourcechange` props (7-31);
  drop the now-unused `EMBEDDING_SOURCES` import; add tooltips on
  Preprocessing (`PREPROCESSING_TOOLTIP`, and `title={p.description}` on
  each `<option>`), Metric (`METRIC_TOOLTIP`, `title={m.description}`),
  Token class (`TOKEN_CLASS_TOOLTIP`), the three exclusion checkboxes,
  Top-k (`TOPK_TOOLTIP`), Floor ε (`EPSILON_TOOLTIP`).
- `src/routes/+page.svelte` — edit mode (414-454): add an
  `EmbeddingSourcePicker` group (next to tokenizer/strategy pickers) shown
  when `strategyStore.currentId === 'embedding-knn'`; explore control
  strip (546-575): add the same picker conditionally; drop
  `sourceId`/`onsourcechange` from the `EmbeddingParams` binding
  (627-651).
- `src/lib/embeddings/types.ts` — add `plainName: string`,
  `gloss: string`, `tooltip: { text: string; math?: string }` to
  `EmbeddingSourceInfo` (15-33).
- `src/lib/embeddings/sources.ts` — populate the three new fields on all
  three `EMBEDDING_SOURCES` entries (13-41).
- `src/lib/stores/embedding.svelte.ts` — defaults at 20/24/32/36:
  `'mean-center'`, `'word-initial'`, `20`, `0.1`.
- `src/lib/strategies/registry.ts` — fallback at 144/146/151/153:
  `'mean-center'`, `'word-initial'`, `20`, `0.1`.
- `src/lib/strategies/embedding-knn.ts` — `plainName` (68) →
  `'Drift by language model'`; reword `tooltip.text` (75) so ε is optional.
- `src/lib/strategies/registry.test.ts` — 134-143.
- `src/lib/embeddings/knn-index.ts` — `precomputeRows` (333-371).
- `src/lib/workers/trajectory.worker.ts` — BFS block (356-388).
- `src/lib/embeddings/knn-index.test.ts` — new progress/deadline cases.
- `src/lib/components/InfoTooltip.test.ts` — extend registry-field test to
  cover `EMBEDDING_SOURCES`.
- `src/lib/strategies/README.md` (line 38) and
  `src/lib/embeddings/README.md` (`## Notes`, 105+).

## Exact copy to use

`kernel-help.ts`:

- `KERNEL_CAPTION` last clause becomes: `'...neighbourhood; setting Floor
  ε above 0 keeps every token reachable.'`
- `TOPK_TOOLTIP`: text "How many nearest tokens a jump may land on.
  Larger k spreads jumps over more candidates (and costs more to
  compute); smaller k keeps jumps concentrated on the closest matches.",
  math `j \in N_k(i),\ |N_k(i)| = k`.
- `EPSILON_TOOLTIP`: text "The optional ergodicity floor: with
  probability ε a jump ignores the neighbourhood and lands on any token
  uniformly. At ε = 0 tokens only move between nearest neighbours; raising
  it keeps the process connected even when the neighbourhood graph is
  not.", math `P(y\mid i) = (1-\varepsilon)\,K_\tau(y\mid i) +
  \varepsilon/K`.

`param-help.ts` (plain words; math raw KaTeX, no `$`):

- `MAX_DISTANCE_TOOLTIP`: "How far a jump may reach, in edit-distance
  units. Distance 1 keeps noise to near-identical spellings; larger values
  reach broader misspellings." math `d(i,j) \le \text{maxDistance}`.
- `MIN_SIMILARITY_TOOLTIP`: "How alike two tokens' characters must be
  before a jump is allowed. Higher values restrict jumps to near-identical
  token shapes; lower values permit looser overlaps." math `J(i,j) \ge s`.
- `MULTISET_TOOLTIP`: "When on, repeated characters count: 'aab' and 'ab'
  differ. When off, only the distinct set of characters matters." (no math)
- `PREPROCESSING_TOOLTIP`: "How embedding rows are transformed before
  distances are computed. Raw is fastest but noisiest; mean-center and
  whiten remove the dominant shared component so nearest neighbours
  reflect meaning rather than overall frequency." math
  `x \mapsto x - \bar{x}`. Each `<option>` also gets
  `title={p.description}` to reuse `PREPROCESSINGS[*].description`.
- `METRIC_TOOLTIP`: "How distance between two embedding vectors is
  measured. Cosine compares direction and ignores magnitude, which usually
  works best in high dimensions; L2 compares straight-line distance."
  math `1-\cos(a,b) \quad\text{vs}\quad \lVert a-b\rVert_2`.
- `TOKEN_CLASS_TOOLTIP`: "Which tokens may be jump targets. Word-initial
  only lands on tokens that begin a word (avoids gluing word fragments);
  Continuation only on mid-word pieces; Any allows both." (no math)
- `EXCLUDE_SPECIAL_TOOLTIP`: "Skip special tokens such as [CLS], [SEP]
  and </s> as jump targets — they carry no word meaning." (no math)
- `EXCLUDE_UNUSED_TOOLTIP`: "Skip BERT [unusedN] placeholder rows that
  fill out the vocabulary." (no math)
- `EXCLUDE_BYTE_FALLBACK_TOOLTIP`: "Skip byte-fallback tokens like <0x4F>,
  which stand for raw bytes rather than words." (no math)
- `RATE_MULTIPLIER_TOOLTIP`: "Scales how much noise the schedule applies
  everywhere: higher values corrupt faster, lower values slower. 1 is the
  schedule as designed." math `\beta_t \mapsto \lambda\,\beta_t`.

`embedding-knn.ts` `EMBEDDING_KNN_INFO.tooltip.text` — replace the final
sentence with: "An optional uniform floor ε mixes in a little noise so the
process stays connected; at ε = 0 tokens only ever jump between embedding
neighbours."

`sources.ts` new fields:

- `bert-base-uncased`: plainName "BERT (input)"; gloss "Word embeddings
  from BERT's input table."; tooltip.text "The input word-embedding matrix
  of bert-base-uncased; a good default for English word similarity."
- `gpt2`: plainName "GPT-2 (input)"; gloss "GPT-2's input word embeddings
  (wte); the default."; tooltip.text "GPT-2 input embeddings (wte)."
- `gpt2-lmhead`: plainName "GPT-2 (output)"; gloss "GPT-2's output
  (lm_head) embeddings."; tooltip.text "GPT-2 output embeddings
  (lm_head); for base GPT-2 these are tied to the input matrix, so results
  may match GPT-2 (input)."

## Expected reviewable surface

- Behavioural (small): 4 default values × 2 locations; `plainName` rename;
  ε tooltip + caption rewording; `precomputeRows` deadline argument and
  progress-on-skip; worker BFS deadline checks.
- Structural/UI (larger but low-risk): six Svelte components touched;
  new `EmbeddingSourcePicker.svelte` and `param-help.ts` (+ tests); one
  `<select>` removed and one new picker wired in `+page.svelte`;
  `EmbeddingSourceInfo` gains 3 fields.
- Mechanical: import additions, tooltip markup insertion, doc wording.
- Risk budget: no changes to sampling math or RNG draw order; no worker
  protocol/type changes; no new dependencies.

## Ordered implementation steps

1. `kernel-help.ts`: soften `KERNEL_CAPTION`; add `TOPK_TOOLTIP`,
   `EPSILON_TOOLTIP`; update `kernel-help.test.ts` `COPY`.
2. Add `param-help.ts` + `param-help.test.ts`.
3. Add tooltips to `LexicalParams.svelte`, `CharOverlapParams.svelte`,
   `ScheduleParams.svelte` (imports from both help modules).
4. `embeddings/types.ts` + `sources.ts`: add and populate
   `plainName`/`gloss`/`tooltip`; extend `InfoTooltip.test.ts` to assert
   these for every source.
5. Create `EmbeddingSourcePicker.svelte`.
6. `EmbeddingParams.svelte`: remove Source select + its props/import; add
   tooltips and option `title` attributes.
7. `+page.svelte`: render `EmbeddingSourcePicker` in edit `.edit-pickers`
   and the explore control-strip (conditionally on embedding-knn); remove
   `sourceId`/`onsourcechange` from the `EmbeddingParams` binding.
8. Retune defaults in `embedding.svelte.ts` and `registry.ts`; update and
   rename the `registry.test.ts` default test.
9. `embedding-knn.ts`: rename `plainName`; reword ε tooltip.
10. `knn-index.ts`: add optional `deadline?: number` param to
    `precomputeRows`; check it at the top of each chunk and break; emit
    `onProgress?.(i + 1, total)` before the memoized `continue` (350).
11. `trajectory.worker.ts`: compute `const deadline = warmStart +
    WARMUP_TIME_BUDGET_MS`; guard the frontier expansion with
    `performance.now() < deadline`; pass `deadline` to `precomputeRows`;
    break if expired after a batch.
12. Docs: `strategies/README.md` line 38 wording; add recommended-defaults
    bullet at the top of `embeddings/README.md` `## Notes`.

## Tests to add

- `src/lib/components/param-help.test.ts`: assert every exported `ParamHelp`
  has non-empty `text`, and every `math` that is present renders via
  `katex.renderToString(..., { throwOnError: false })` without
  `'katex-error'` (mirror `kernel-help.test.ts`).
- `src/lib/components/kernel-help.test.ts`: add `TOPK_TOOLTIP` and
  `EPSILON_TOOLTIP` to `COPY`.
- `src/lib/components/InfoTooltip.test.ts`: extend the registry test to
  assert each `EMBEDDING_SOURCES` entry has non-empty `plainName`, `gloss`,
  `tooltip.text` and KaTeX-clean `tooltip.math` when present.
- `src/lib/strategies/registry.test.ts:134-143`: rename to e.g.
  `'defaults for embedding-knn use the retuned params'`; assert
  `maxDistance === null`, all `exclude* === true`, `tokenClass ===
  'word-initial'`, `preprocess === 'mean-center'`, `k === 20`,
  `tau === 0.1`, `epsilon === 0`, `family === 'exponential'`.
- `src/lib/embeddings/knn-index.test.ts`: new case — precompute a token
  set, then call `precomputeRows` on the same set again and assert the last
  progress call is `[total, total]` (exercises the memoized skip path);
  new case — pass `deadline = performance.now()` (or `0`) and assert the
  call returns without processing all tokens.

## Verification commands

Run in this order, from the repo root:

1. `npm run check`
2. `npm run lint`
3. `npm run format`
4. `npm run test`

## Edge cases, risks, out-of-scope

- Removing `sourceId`/`onsourcechange` from `EmbeddingParams` must not
  leave an unused `EMBEDDING_SOURCES` import (lint error); `+page.svelte`
  still needs it for the picker and the tokenizer-alignment `$effect`
  (400-406).
- The picker must stay disabled while `tokenizerStore.status !== 'ready'`
  and respect `tokenizerLocked` semantics; selecting a source whose
  `tokenizerId` differs must still trigger the existing alignment effect.
- Deadline behaviour: breaking between chunks is best-effort; worst case
  overrun is one chunk (≤ 128 rows). Do not emit `[total, total]` after an
  early break.
- `precomputeRows`' `deadline` must be optional so existing call sites and
  tests compile unchanged.
- Out of scope: AC3 hubness/overlap diagnostics (#58/#12); aggregate
  'embeddings' progress totals; removing the unused `k` param on
  `ensureEmbeddingProvider` (not an open finding).
- No open blocking questions.
