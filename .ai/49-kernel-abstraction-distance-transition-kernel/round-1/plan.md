# Plan: Issue #49 — Kernel abstraction: distance → transition kernel

- Round: 1
- Addresses: none (initial plan)
- Branch: `49-kernel-abstraction-distance-transition-kernel`

## Goal and acceptance criteria

Factor the distance-based substitution strategies onto a shared kernel abstraction so that
"how much noise" (schedule, $\beta_t$) stays separate from "where tokens go" (kernel,
$K_\tau$). Introduce a `DistanceSource` (neighbor-table producer), a `TokenKernel`
(cheap, derived at sample time), selectable weight families, and one `StringDistanceKernel`
composition for string distances. Port lexical, char-overlap and uniform onto it.

Acceptance criteria (issue #49):

- Existing strategies reimplemented on the abstraction; behaviour statistically equivalent,
  with golden-seed tests changed deliberately (not accidentally).
- Each row of $K_\tau$ sums to 1 and excludes the self-token.
- $\beta = 0$ gives identity; $\tau \to 0$ collapses to the nearest neighbor; $\tau \to \infty$
  gives uniform over the top-$k$.
- Changing $\tau$, weight family, or $\epsilon$ does not invalidate the neighbor-table cache.
- Disconnected-graph detection still works and is reported in diagnostics.

## Scope decisions (confirmed with the human before planning)

- **Core kernel only.** Round 1 delivers `DistanceSource`, `TokenKernel`, weight families,
  `StringDistanceKernel`, and ports lexical/char-overlap/uniform. Persistent IndexedDB
  caching and disconnected-graph diagnostics are deferred to follow-up issues.
- **Cache is in-memory this round.** The worker-lifetime memoized neighbor tables stay; the
  cache key is designed as `(tokenizerId, DistanceSource id + params, k)` but is not persisted.
  The AC is read as cache-agnostic.
- **Diagnostics deferred.** No connectivity detection in this round; recorded in Out of scope.
- **Config + minimal UI.** Weight family and `tau` are threaded through configs and get a small
  control in the lexical/char-overlap param components; no larger UI work.

## Locked decisions

- **Reuse the existing substrate; do not rewrite distance code.** `DistanceModel`,
  `EditDistanceModel`, `CharOverlapModel`, `levenshtein`, and `NeighborhoodProvider` are kept.
  `ModelDistanceSource` is a thin adapter that exposes `topK` over a provider.
- **Self-exclusion is already satisfied.** `EditDistanceModel.candidates`
  (`distance-model.ts:200,225`) and `CharOverlapModel.candidates`
  (`char-overlap-model.ts:124,136`) already skip `j === token`, so neighbor lists never contain
  self. `ModelDistanceSource.topK` still filters `id === tokenId` defensively. Consequence:
  default (exponential, `family` absent) trajectories are **bit-identical** to today.
- **The strategy factory signature does not change.** `StrategyFactory`/`getStrategy` keep their
  third `provider?: NeighborhoodProvider` parameter (`types.ts:107-111`, `registry.ts:146-157`).
  The factory wraps the provider in a `ModelDistanceSource` internally. This keeps the worker
  boundary, `neighbor-graph.ts`, `union-graph.ts`, and all tests' construction unchanged.
- **`getLocalDistribution` semantics preserved.** lexical/char-overlap keep returning the
  floor-mixed jump row (ignoring `beta`); uniform keeps its $\beta$-aware $Q_t$ row. Only the
  degenerate empty-neighbor row is normalised (see Edge cases).
- **Exponential is the default family and reproduces the current softmax**
  $w = \exp(-d/\tau)$ exactly (including max-subtraction), so existing tests must pass unchanged.
- **Power-law uses a shifted base** `(1 + d)^{-1/\tau}` rather than the literal $d^{-p}$: it
  reuses the single temperature $\tau$, stays finite at $d = 0$, and has the required limits
  ($\tau \to 0$ nearest, $\tau \to \infty$ uniform). Documented in the source.
- **identity and absorbing are not ported.** identity is the zero-draw identity element;
  absorbing has a 1-draw contract and a `vocabSize + 1` sentinel row. Porting them solely for
  uniformity would change their RNG draw counts. Left unchanged and listed in Out of scope.

## Branch prep (before /implement; /plan cannot run it under plan mode)

Current branch is `main`. The issue branch already exists:

```bash
git rev-parse --abbrev-ref HEAD   # expect main
git switch 49-kernel-abstraction-distance-transition-kernel
```

If the branch were missing, create it with
`git switch -c 49-kernel-abstraction-distance-transition-kernel`.

## Files to create/modify

### `src/lib/strategies/weight-family.ts` (new)

Pure weight functions for $K_\tau$. No imports from workers/schedules/stores.

```ts
export type WeightFamilyId = 'exponential' | 'power-law' | 'gaussian';

export interface WeightFamily {
	readonly id: WeightFamilyId;
	readonly label: string;
	/** Unnormalized weight for a neighbor at distance `dist`, temperature `tau > 0`. */
	weight(dist: number, tau: number): number;
}

export const WEIGHT_FAMILIES: Record<WeightFamilyId, WeightFamily>;
export function getWeightFamily(id: string): WeightFamily; // throws on unknown id
export function isWeightFamilyId(id: string): id is WeightFamilyId;
```

- `exponential`: `Math.exp(-dist / tau)`.
- `power-law`: `Math.pow(1 + dist, -1 / tau)`.
- `gaussian`: `Math.exp(-(dist * dist) / (2 * tau * tau))`.

### `src/lib/strategies/distance-source.ts` (new)

Neighbor-table producer keyed by `(id, params)`; the unit that an IndexedDB cache would key on.

```ts
import type { DistanceModel } from './distance-model.js';
import type { NeighborhoodProvider } from './neighborhood.js';

export interface NeighborTable {
	readonly ids: Int32Array;
	readonly dists: Float32Array;
}

export interface DistanceSource {
	readonly id: string;
	readonly params: Record<string, unknown>;
	readonly vocabSize: number;
	/** Top-k nearest within maxDistance, self excluded, ascending by distance. */
	topK(tokenId: number, k: number, maxDistance: number): NeighborTable;
	/** Raw distance for logWeight composition, capped at the provider radius. */
	distance(a: number, b: number): number;
}

export class ModelDistanceSource implements DistanceSource {
	constructor(model: DistanceModel, provider: NeighborhoodProvider, opts?: { maxStored?: number });
}
```

- `id` = `model.id`; `params` = `{ rMax: provider.R_MAX, maxStored }` (serializable, informational).
- `vocabSize` = `model.K`.
- `topK` iterates `provider.neighborsOf(tokenId)` (already distance-sorted and truncated to
  `maxStored`), skips `id === tokenId`, keeps `dist <= maxDistance`, stops at `k`, and copies
  into `Int32Array`/`Float32Array`.
- `distance(a, b)` delegates to `model.distance(a, b, provider.R_MAX)`.

### `src/lib/strategies/token-kernel.ts` (new)

Cheap kernel derived from a `DistanceSource` at sample time.

```ts
import type { Rng } from './types.js';
import type { DistanceSource } from './distance-source.js';
import type { WeightFamily } from './weight-family.js';

export interface KernelRow {
	readonly ids: Int32Array;
	readonly probs: Float32Array;
}

export interface TokenKernel {
	/** j ~ K(. | token); draws exactly 1 rng value. */
	sampleStep(token: number, rng: Rng): number;
	/** Sparse row of K_tau: self excluded, sum to 1 over ids (empty if no neighbors). */
	getRow(token: number): KernelRow;
	logWeight?(i: number, j: number): number;
}

export interface KernelParams {
	k: number;
	maxDistance: number;
	tau: number;
	epsilon: number;
	vocabSize: number;
}

export function createTokenKernel(
	source: DistanceSource,
	family: WeightFamily,
	params: KernelParams,
): TokenKernel;

export function createUniformKernel(vocabSize: number, epsilon: number): TokenKernel;

/** Dense row of jump distribution: (1-eps) * probs at ids + eps/vocabSize everywhere. */
export function kernelRowToDense(
	dist: Float32Array,
	row: KernelRow,
	epsilon: number,
	vocabSize: number,
): Float32Array;
```

- `getRow(token)`: `table = source.topK(token, k, maxDistance)`; if empty return empty row
  (`Int32Array(0)`, `Float32Array(0)`); else `weights[i] = family.weight(dists[i], tau)`,
  subtract `Math.max(...weights)`, `exp`, normalise. Memoize rows in a `Map<number, KernelRow>`.
- `sampleStep(token, rng)`: one `const draw = rng()`; if `epsilon > 0 && draw < epsilon` return
  `Math.min(Math.floor((draw / epsilon) * vocabSize), vocabSize - 1)`; else `row = getRow(token)`;
  if empty return `Math.min(Math.floor(draw * vocabSize), vocabSize - 1)`; else
  `v = epsilon > 0 ? (draw - epsilon) / (1 - epsilon) : draw` and inverse-CDF over `probs`
  (return the last id if `v` exceeds the cumulative sum).
- `logWeight?(i, j)` = `Math.log(family.weight(source.distance(i, j), tau))`.
- `createUniformKernel(vocabSize, epsilon)`: `getRow` uniform over `[0, vocabSize)`;
  `sampleStep` = `Math.min(Math.floor(draw * vocabSize), vocabSize - 1)` with the same epsilon
  floor branch. (Matches `uniform.ts` sampling exactly.)
- `kernelRowToDense`: `dist.fill(epsilon / vocabSize)`, then
  `dist[ids[i]] += (1 - epsilon) * probs[i]`. If `row` is empty, `dist.fill(1 / vocabSize)`.

### `src/lib/strategies/kernel-strategy.ts` (new)

Shared strategy body wrapping a kernel with the $\beta$ coin.

```ts
import type { NoiseStrategy, StrategyInfo } from './types.js';
import type { TokenKernel } from './token-kernel.js';

export interface KernelStrategyOptions<Config> {
	info: StrategyInfo;
	config: Config;
	vocabSize: number;
	/** Kernel used on a jump; `null` means "no table → uniform over vocab". */
	kernel: TokenKernel | null;
	epsilon: number;
}

export function createKernelStrategy<Config>(
	opts: KernelStrategyOptions<Config>,
): NoiseStrategy<Config>;
```

- `sampleStep(token, beta, rng)`: `const coin = rng();` then `if (coin >= beta) return token;`
  then either `Math.min(Math.floor(rng() * vocabSize), vocabSize - 1)` when `kernel === null`,
  or `kernel.sampleStep(token, rng)`. Exactly **2** draws in both branches.
- `getLocalDistribution(token, _beta)`: reuse a `Float32Array(vocabSize)`; `kernel === null` →
  `_dist.fill(1 / vocabSize)`; else `kernelRowToDense(_dist, kernel.getRow(token), epsilon, vocabSize)`.

### `src/lib/strategies/string-distance-kernel.ts` (new)

One composition of "a string function applied to each token, then a string distance".

```ts
import type { DistanceModel } from './distance-model.js';
import type { CharOverlapMode } from './char-overlap-model.js';

export type StringFn = (raw: string) => string;
export type DistanceFn = (a: string, b: string) => number;

export interface StringDistanceKernel {
	readonly id: string;
	readonly stringFn: StringFn;
	readonly distanceFn: DistanceFn;
	makeModel(strings: readonly string[]): DistanceModel;
}

export const STRING_DISTANCE_KERNELS: Record<string, StringDistanceKernel>;
export function getStringDistanceKernel(id: string): StringDistanceKernel;
export function stringDistanceKernelFor(mode?: CharOverlapMode): StringDistanceKernel;
```

- `edit-distance`: `stringFn = (s) => s`; `distanceFn = (a, b) => levenshtein(a, b, Math.max(a.length, b.length))`;
  `makeModel = (strings) => new EditDistanceModel(strings)`.
- `char-overlap-set` / `char-overlap-multiset`: `stringFn` returns the canonical sorted
  distinct-char / sorted multiset string; `distanceFn` is the matching Jaccard distance
  (set or multiset) over those canonical strings; `makeModel = (strings) => new CharOverlapModel(strings, mode)`.
- `stringDistanceKernelFor('multiset')` → `char-overlap-multiset`, otherwise `char-overlap-set`.
- The optimized candidate indexing stays in the models; `stringFn`/`distanceFn` are the
  genuine, testable string-level composition and the seam for a future phonetic kernel.

### `src/lib/strategies/lexical.ts` (modify)

- Add `family?: WeightFamilyId;` to `LexicalConfig` (optional; default `'exponential'`).
- Replace the factory body with:
  build `family = getWeightFamily(config.family ?? 'exponential')`; if `provider` present build
  `kernel = createTokenKernel(new ModelDistanceSource(provider.model, provider), family, { k, maxDistance, tau, epsilon, vocabSize })`,
  else `null`; return `createKernelStrategy({ info: LEXICAL_INFO, config, vocabSize, kernel, epsilon: config.epsilon })`.
- Keep `LEXICAL_INFO`, the exported `LexicalConfig`, and the doc comment (update the math to
  mention the weight family). Remove the now-unused `neighbor-softmax` imports.

### `src/lib/strategies/char-overlap.ts` (modify)

- Same shape as lexical: add `family?: WeightFamilyId`, build the kernel via `ModelDistanceSource`
  + `createTokenKernel` + `createKernelStrategy`, keep `CHAR_OVERLAP_INFO` and `CharOverlapConfig`
  (including `mode`). `mode` is still consumed by the worker when building the provider.

### `src/lib/strategies/uniform.ts` (modify)

- Keep `UNIFORM_INFO`, `UniformConfig`, and the $\beta$-aware `getLocalDistribution`.
- Replace `sampleStep` internals with `createUniformKernel(vocabSize, 0)`:
  `const coin = rng(); if (coin >= beta) return token; return kernel.sampleStep(token, rng);`
  (identical draws and index math).

### `src/lib/strategies/neighborhood.ts` (modify)

- Expose the model for the adapter: change `private _model` to `readonly model: DistanceModel`
  and update `_pairDistance` to use `this.model`. No other behaviour change.

### `src/lib/strategies/registry.ts` (modify)

- Add `family: _extra?.family ?? 'exponential'` to the `lexical` and `char-overlap` branches of
  `strategyConfigFor` (`registry.ts:116-133`). Remove the unused `NeighborhoodProvider` import if
  it becomes unused (it does not; `getStrategy` still uses it).

### `src/lib/strategies/index.ts` (modify)

- Re-export the new public surface: `WeightFamilyId`, `WeightFamily`, `WEIGHT_FAMILIES`,
  `getWeightFamily`; `DistanceSource`, `ModelDistanceSource`, `NeighborTable`; `TokenKernel`,
  `KernelRow`, `KernelParams`, `createTokenKernel`, `createUniformKernel`, `kernelRowToDense`;
  `KernelStrategyOptions`, `createKernelStrategy`; `StringDistanceKernel`, `StringFn`,
  `DistanceFn`, `STRING_DISTANCE_KERNELS`, `getStringDistanceKernel`, `stringDistanceKernelFor`.

### `src/lib/workers/trajectory.worker.ts` (modify)

- Replace the model construction inside `ensureLexicalProvider`/`ensureCharOverlapProvider`
  with `getStringDistanceKernel(...).makeModel(strings)` (edit-distance, or
  `stringDistanceKernelFor(mode)`), and collapse the two functions into one
  `ensureDistanceSourceProvider(kernelId, tokenizerId, onProgress)`. Keep the `R_MAX` /
  `R_MAX_CHAR` ceilings and `NEIGHBOR_STORE_LIMIT` and the cache maps so provider identity and
  memoisation are unchanged. `getStrategy(...)` calls keep passing the provider.

### `src/lib/stores/lexical.svelte.ts` and `src/lib/stores/charOverlap.svelte.ts` (modify)

- Add `family: WeightFamilyId = $state('exponential')` and include `family: this.family` in the
  `get params()` object.

### `src/lib/components/LexicalParams.svelte` and `CharOverlapParams.svelte` (modify)

- Add a `tau` range input (min 0.05, max 5, step 0.05) and a `family` select
  (Exponential / Power-law / Gaussian), with matching props and `ontauchange` / `onfamilychange`
  callbacks. Mirror the existing slider markup and styles.

### `src/routes/+page.svelte` (modify)

- Pass `tau` and `family` and their change handlers into `LexicalParams`
  and `CharOverlapParams` (around `+page.svelte:563-587`), writing back to the stores.

### `package.json` (modify)

- Bump `version` `1.3.0` → `1.4.0` (this issue is a `feat`, minored once in the round-1 commit).

## Ordered implementation steps

1. Create `weight-family.ts` and its test.
2. Create `distance-source.ts`; expose `readonly model` on `NeighborhoodProvider`; add its test.
3. Create `token-kernel.ts` (`createTokenKernel`, `createUniformKernel`, `kernelRowToDense`) and
   its test.
4. Create `kernel-strategy.ts` and its test.
5. Create `string-distance-kernel.ts` and its test.
6. Port `lexical.ts` to the kernel; run `lexical.test.ts` and confirm it passes unchanged
   (default-exponential bit-identity).
7. Port `char-overlap.ts`; run `char-overlap.test.ts` unchanged.
8. Port `uniform.ts` sampling to `createUniformKernel`; run `uniform.test.ts` unchanged.
9. Add `family` defaults in `registry.ts`; extend `registry.test.ts`.
10. Update `index.ts` barrel exports.
11. Refactor the worker's provider construction through `StringDistanceKernel`; run
    `neighbor-graph.test.ts` and `union-graph.test.ts`.
12. Thread `family` through the stores, param components, and `+page.svelte`.
13. Bump `package.json` to `1.4.0`.
14. Run the full verification sequence.

## Tests to add

- `src/lib/strategies/weight-family.test.ts`: known values per family; monotone decreasing in
  `dist`; `tau -> 0` concentrates on the smallest distance; `tau large` flattens to ratio 1;
  finite at `dist = 0`; `getWeightFamily` throws on unknown.
- `src/lib/strategies/distance-source.test.ts`: `topK` excludes the query token, returns
  ascending distances, respects `k` and `maxDistance`; `id`/`params` are stable across
  `tau`/family/`epsilon` changes (cache-agnostic AC); `distance` delegates.
- `src/lib/strategies/token-kernel.test.ts`: `getRow` sums to 1 and excludes self; top-$k$
  truncation; `sampleStep` draws exactly 1 value; `epsilon` floor branch selects uniformly;
  empty table falls back to uniform; $\tau \to 0$ collapses to the nearest id; $\tau \to \infty$
  yields uniform over the top-$k$.
- `src/lib/strategies/kernel-strategy.test.ts`: $\beta = 0$ returns the token unchanged;
  exactly 2 RNG draws in both provider-present and provider-absent branches; jump goes through
  the kernel; `getLocalDistribution` returns the floor-mixed dense row.
- `src/lib/strategies/string-distance-kernel.test.ts`: each kernel's `distanceFn` matches the
  corresponding model's `distance` for a small vocab; `makeModel` builds a usable model;
  `stringDistanceKernelFor('multiset')` selects the multiset kernel.
- Update `src/lib/strategies/lexical.test.ts` and `char-overlap.test.ts` only to add a
  `family: 'gaussian'` case asserting a different distribution and to keep the existing
  2-draw / self-zero / sum-to-1 assertions. Existing assertions are expected to pass unchanged.
- Update `src/lib/strategies/registry.test.ts`: `strategyConfigFor('lexical'|'char-overlap')`
  now includes `family: 'exponential'` by default and honours `_extra.family`.
- Update `src/lib/strategies/uniform.test.ts` only if a new assertion is useful; existing cases
  must pass unchanged.

## Verification

Run in order:

1. `npm run check`
2. `npm run lint`
3. `npm run format`
4. `npm run test`

Existing `lexical`, `char-overlap`, `uniform`, `neighbor-softmax`, `neighborhood`,
`neighbor-graph`, `union-graph`, and `trajectory` tests must pass. Any failure indicates an
unintended behaviour change and must be investigated, not blindly refreshed.

## Edge cases and risks

- **Empty neighbor row.** The old lexical/char-overlap `getLocalDistribution` returned all-zero
  when neighbors existed but none passed the filter and `epsilon = 0`; the new
  `kernelRowToDense` normalises an empty row to uniform. This is an intentional fix (the AC
  requires every row to sum to 1) and is not pinned by any existing test.
- **`maxStored` truncation precedes read-time filtering.** `NeighborhoodProvider` truncates to
  200 before `maxDistance`/`k` are applied; this is pre-existing and preserved. `params.maxStored`
  is informational only.
- **`family` and `tau` change the trajectory cache key** (`strategyConfigJson`), which is
  correct — a different kernel is a different trajectory. The AC is about the neighbor-table
  cache, which is keyed only on the source, so it is unaffected.
- **Floating-point identity.** Exponential weights must use the same max-subtraction and
  normalisation order as `resolveNeighbors` to keep trajectories bit-identical; the plan requires
  the existing tests to pass as the guard.
- **Power-law deviation** from the literal $d^{-p}$ is deliberate (shifted base, single
  temperature) and must be documented in the source.
- **`tau` valid range.** Non-positive `tau` is undefined for the families; the UI slider lower
  bound (0.05) plus a guard is expected, but config-level validation is not enforced this round.

## Out of scope

- Persistent IndexedDB neighbor-table caching and its `(tokenizer, DistanceSource id + params, k)`
  key. Deferred to a follow-up issue.
- Disconnected-graph detection and diagnostics reporting. Deferred to a follow-up issue.
- Porting `identity` and `absorbing` onto the kernel (zero-draw / one-draw RNG contracts).
- Eager full-table kernel path and graph-view progress reporting through the loading bar.
- A generic candidate index parameterised purely by `(stringFn, distanceFn)`; the optimized
  `EditDistanceModel`/`CharOverlapModel` candidate generators are reused as-is.
- `docs/libraries.md`, `DESIGN.md`, and `AGENT_CONTEXT.md` updates.

## Open blocking questions

- None. Scope was confirmed with the human before planning; the deferred items above are
  explicitly recorded rather than left implicit.
