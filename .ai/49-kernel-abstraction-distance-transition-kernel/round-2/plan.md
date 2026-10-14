# Plan: Issue #49 — Kernel abstraction: distance → transition kernel (round 2)

- Round: 2
- Addresses: R1-N1, R1-N2, R1-N3, R1-N4; new requirements
- Branch: `49-kernel-abstraction-distance-transition-kernel`

## Goal and acceptance criteria

Close all four findings from the round-1 review (N1–N4) and add user-facing
explanations for the new kernel settings. No new kernel features; round 1
already landed the abstraction.

Round-2 acceptance criteria:

- `isWeightFamilyId`, `getWeightFamily`, `getStringDistanceKernel`, and the
  worker's radius lookup reject `Object.prototype` keys (`'toString'`,
  `'constructor'`, `'hasOwnProperty'`, …) with the intended "Unknown …" error
  instead of blessing inherited members or crashing with a `TypeError`.
- Tooltip neighborhood edges and union-graph neighborhood edges use the
  selected weight family, so they match the kernel the walk used. The default
  (`'exponential'`) is bit-identical to today.
- `ModelDistanceSource.params.maxStored` reports the provider's actual store
  cap on the real path (`200`), not `null`, so a future persistent cache keyed
  on `params` distinguishes a truncated table from an unbounded one.
- Non-positive `tau` never yields `NaN`: the kernel and neighborhood weights
  clamp `tau` to a small positive floor and collapse toward the nearest
  neighbor, consistent with the $\tau \to 0$ limit.
- The advanced settings explain τ, the weight family, and the kernel itself:
  a short plain-language caption plus `?` tooltips (plain language first,
  KaTeX maths second), per DESIGN §6.1/§8.
- `npm run check`, `npm run lint`, `npx prettier --check .`, and
  `npm run test` are all clean; existing math tests pass unchanged except for
  deliberate additions.

## New requirements

Human requirement block, verbatim:

> Implement fixes to the findings and also add user-facing explanations on the
> new settings in the advanced settings. Currently the kernel approach is
> completely unexplained to the user, and that needs to be fixed.

Follow-up human instruction, verbatim:

> Also add the N3/N4 to the plan.

Folded into this plan:

- **R-fixes.** "the findings" covers the round-1 review's findings. The
  `- Open findings:` line lists `N1, N2`; the follow-up explicitly extends
  scope to `N3` and `N4`. All four are fixed below.
- **R-explain.** Add explanations for the new settings (temperature τ and
  weight family) in the advanced settings, and a kernel-level explainer
  ("how much vs. where"), because the kernel approach is currently
  unexplained to the user. This is the UI copy work below.

## Findings and actions

- **R1-N1 — inherited-key hole in id guards.** Fix `isWeightFamilyId` to use
  `Object.hasOwn(WEIGHT_FAMILIES, id)`; fix `getStringDistanceKernel`'s guard
  to `!Object.hasOwn(STRING_DISTANCE_KERNELS, id)`; fix the worker's
  `R_MAX_BY_KERNEL[kernelId] ?? R_MAX` to an own-property check. Add
  inherited-key rejection tests.
- **R1-N2 — graph neighborhood edges ignore the selected weight family.**
  Thread the family through `NeighborGraphParams` and derive neighborhood
  weights from the family in both `buildNeighborGraph` and `buildUnionGraph`.
  Implement by giving `resolveNeighbors` an optional `family: WeightFamily`
  defaulting to exponential (so every existing call site/test compiles and
  the exponential path is bit-identical), then pass the selected family from
  the two builders.
- **R1-N3 — `ModelDistanceSource.params.maxStored` is `null` on the real
  path.** Expose the provider's cap as `NeighborhoodProvider.maxStored` and
  default the source's recorded `maxStored` to it (normalizing non-finite to
  `null`). No factory-signature change; the provider already carries the value
  the worker set (`NEIGHBOR_STORE_LIMIT`).
- **R1-N4 — no `tau` guard; `tau = 0` yields `NaN`.** Add `MIN_TAU` and a
  `clampTau` helper in `weight-family.ts`, and clamp `tau` in
  `createTokenKernel` and `resolveNeighbors` so every row stays finite and the
  $\tau \to 0$ limit holds.

## Files to create/modify

### `src/lib/strategies/weight-family.ts` (modify)

- Replace the guard at `weight-family.ts:91-93`:

```ts
export function isWeightFamilyId(id: string): id is WeightFamilyId {
	return Object.hasOwn(WEIGHT_FAMILIES, id);
}
```

`getWeightFamily` is unchanged (`weight-family.ts:81-88`); it now throws for
inherited keys. Keep the doc comment on the guard accurate.

- Add the temperature guard near the type declarations:

```ts
/** Smallest positive temperature; floors the $\tau \to 0$ limit at a finite value. */
export const MIN_TAU = 1e-6;

/** Clamp a temperature to the strictly-positive domain (guards $\tau \le 0$ and non-finite). */
export function clampTau(tau: number): number {
	return Number.isFinite(tau) && tau > MIN_TAU ? tau : MIN_TAU;
}
```

### `src/lib/strategies/token-kernel.ts` (modify)

- Import `clampTau` from `./weight-family.js`.
- In `createTokenKernel` (`token-kernel.ts:70`), drop `tau` from the
  destructure and clamp once: `const tau = clampTau(params.tau);`. The existing
  `family.logWeight(table.dists[i]!, tau)` at `:87` then uses the clamped
  value. With `tau = MIN_TAU` the max-subtracted softmax collapses to the
  nearest neighbor and stays finite.

### `src/lib/strategies/string-distance-kernel.ts` (modify)

Replace the truthy lookup at `string-distance-kernel.ts:114-122`:

```ts
export function getStringDistanceKernel(id: string): StringDistanceKernel {
	if (!Object.hasOwn(STRING_DISTANCE_KERNELS, id)) {
		throw new Error(
			`Unknown string distance kernel "${id}". Known: ${Object.keys(STRING_DISTANCE_KERNELS).join(', ')}`,
		);
	}
	return STRING_DISTANCE_KERNELS[id]!;
}
```

`stringDistanceKernelFor` (`:128-132`) keeps its `!` indexing — it is only
ever called with a literal mode.

### `src/lib/strategies/neighborhood.ts` (modify)

- Make the store cap public: change `private readonly _maxStored: number;`
  (`neighborhood.ts:63`) to `readonly maxStored: number;`.
- Update the constructor assignment (`:80`) to `this.maxStored = opts.maxStored ?? Infinity;`.
- Update `neighborsOf` (`:103`) to use `this.maxStored`.
- Update the class doc to mention the public `maxStored` cap.

### `src/lib/strategies/distance-source.ts` (modify)

- In the `ModelDistanceSource` constructor (`distance-source.ts:80`), default
  to the provider's cap and normalize a non-finite cap to `null`:

```ts
const maxStored = opts?.maxStored ?? provider.maxStored;
this.params = {
	rMax: provider.R_MAX,
	maxStored: Number.isFinite(maxStored) ? maxStored : null,
};
```

- Update the `ModelDistanceSourceOptions.maxStored` doc (`:46-53`): default is
  now the provider's store limit; a non-finite limit is recorded as `null`.
  On the real path (`lexical.ts:99`, `char-overlap.ts:103`) the worker built
  the provider with `{ maxStored: NEIGHBOR_STORE_LIMIT }`, so
  `params.maxStored === 200`.

### `src/lib/workers/trajectory.worker.ts` (modify)

- Replace `trajectory.worker.ts:144-146`:

```ts
const rMax = Object.hasOwn(R_MAX_BY_KERNEL, kernelId) ? R_MAX_BY_KERNEL[kernelId]! : R_MAX;
const provider = new NeighborhoodProvider(model, rMax, {
	maxStored: NEIGHBOR_STORE_LIMIT,
});
```

- Add `import type { WeightFamilyId } from '../strategies/weight-family.js';`.
- In `handleNeighbors` (`:265-282`) and `handleUnionGraph` (`:349-366`), widen
  the config cast to
  `{ maxDistance?: number; k?: number; tau?: number; family?: WeightFamilyId }`
  and add `family: cfg.family ?? 'exponential'` to each `graphParams` object.

### `src/lib/strategies/neighbor-softmax.ts` (modify)

- Add imports: `import { clampTau, getWeightFamily } from './weight-family.js';`
  and `import type { WeightFamily } from './weight-family.js';`.
- Give `resolveNeighbors` a fifth parameter (`neighbor-softmax.ts:26-31`):

```ts
export function resolveNeighbors(
	allNeighbors: readonly { id: number; dist: number }[],
	maxDistance: number,
	k: number,
	tau: number,
	family: WeightFamily = getWeightFamily('exponential'),
): ResolvedNeighbors | null {
```

- Clamp the temperature and use the family at the hard-coded logits
  (`neighbor-softmax.ts:41-42`):

```ts
// Family weights, log-space with max subtraction: $w_\tau(d_m)$.
const safeTau = clampTau(tau);
const logits = entries.map((n) => family.logWeight(n.dist, safeTau));
```

- Update the doc comment (`neighbor-softmax.ts:21-22`) from
  `$w_m = \exp(-d_m/\tau)$` to `$w_m = w_\tau(d_m)$`, noting the default
  family is exponential and `tau` is clamped. Exponential `logWeight` is
  exactly `-d/tau`, so the default path is bit-identical.

### `src/lib/strategies/neighbor-graph.ts` (modify)

- Add `family?: WeightFamilyId;` to `NeighborGraphParams`
  (`neighbor-graph.ts:37-41`) with an import of the type.
- In `buildNeighborGraph`, after destructuring (`neighbor-graph.ts:181`),
  resolve the family once and pass it:

```ts
const { maxDistance, k, tau } = params;
const family = getWeightFamily(params.family ?? 'exponential');
...
const resolved = resolveNeighbors(provider.neighborsOf(node.id), maxDistance, k, tau, family);
```

Import `getWeightFamily` at the top.

### `src/lib/engine/union-graph.ts` (modify)

- Pass 2 (`union-graph.ts:250-255`): resolve the family once before the loop
  and pass it to `resolveNeighbors`:

```ts
const { maxDistance, k, tau } = params;
const family = getWeightFamily(params.family ?? 'exponential');
...
const resolved = resolveNeighbors(provider.neighborsOf(ids[anchor]!), maxDistance, k, tau, family);
```

Import `getWeightFamily` from `../strategies/weight-family.js`.

### `src/lib/strategies/index.ts` (modify)

- Re-export `MIN_TAU` and `clampTau` from `./weight-family.js` alongside the
  existing weight-family exports (`index.ts:21-22`).

### `src/lib/components/kernel-help.ts` (new)

Single source of truth for the new UI copy so `LexicalParams` and
`CharOverlapParams` cannot drift. Plain words in `text`, raw KaTeX (no `$`
delimiters) in `math`, matching `StrategyInfo.tooltip` and
`InfoTooltip`'s `math` prop.

```ts
export interface HelpCopy {
	readonly text: string;
	readonly math: string;
}

/** One-sentence caption above the kernel controls. */
export const KERNEL_CAPTION: string;

/** Math for a jump: $Q_t = (1-\beta_t)I + \beta_t K_\tau$. */
export const KERNEL_TOOLTIP: HelpCopy;
export const TAU_TOOLTIP: HelpCopy;
export const FAMILY_TOOLTIP: HelpCopy;
```

Content (final wording may be lightly polished, meaning fixed):

- `KERNEL_CAPTION`: "Weight family and temperature τ decide *where* a token
  jumps (the kernel); the schedule decides *how often* it jumps. Top-k and
  Max distance set the neighbourhood, and Floor ε keeps every token
  reachable."
- `KERNEL_TOOLTIP.text`: "A jumping token is drawn from a transition kernel
  over its nearest neighbours. Distances are turned into weights by the
  family and temperature, then normalised so every row sums to one. The token
  itself is excluded, and the ergodicity floor ε mixes in a little uniform
  noise so no token becomes unreachable."
  `KERNEL_TOOLTIP.math`:
  `K_\tau(j\mid i) \propto w_\tau(d(i,j)),\ j \in N_k(i)\setminus\{i\};\quad Q_t = (1-\beta_t)\,I + \beta_t\,K_\tau`
- `TAU_TOOLTIP.text`: "Temperature controls how far a jump strays. Low τ
  sends almost every jump to the single nearest neighbour; high τ spreads
  the choice almost evenly across the k nearest tokens."
  `TAU_TOOLTIP.math`:
  `\tau \to 0:\ \text{nearest neighbour};\quad \tau \to \infty:\ \text{uniform over top-}k`
- `FAMILY_TOOLTIP.text`: "The weight family decides how fast probability
  falls off with distance. Exponential decays smoothly; power law has a
  heavy tail (occasional long jumps); Gaussian falls off very quickly
  (almost only the nearest neighbours)."
  `FAMILY_TOOLTIP.math`:
  `w_\tau(d) = \exp(-d/\tau);\quad (1+d)^{-1/\tau};\quad \exp\!\left(-d^2/2\tau^2\right)`

### `src/lib/components/LexicalParams.svelte` (modify)

- Import `InfoTooltip from './InfoTooltip.svelte';` and
  `{ KERNEL_CAPTION, KERNEL_TOOLTIP, TAU_TOOLTIP, FAMILY_TOOLTIP } from './kernel-help.js';`.
- Change the τ label text span (`LexicalParams.svelte:76`) to include the
  tooltip: `<span>τ <InfoTooltip text={TAU_TOOLTIP.text} math={TAU_TOOLTIP.math} /></span>`.
- Change the Family label text span (`:90`) likewise with `FAMILY_TOOLTIP`.
- Below `<div class="param-grid">` (`:101`), add:

```svelte
<p class="kernel-caption">
	{KERNEL_CAPTION}
	<InfoTooltip text={KERNEL_TOOLTIP.text} math={KERNEL_TOOLTIP.math} />
</p>
```

- Add `.kernel-caption` styling matching the established hint style:
  `font-size: var(--font-size-xs); color: var(--color-text-quiet); margin: 0;`
  (same recipe as `AdvancedPanel.svelte:177-181`).

### `src/lib/components/CharOverlapParams.svelte` (modify)

Same changes as `LexicalParams.svelte` at `CharOverlapParams.svelte:90`
(τ span), `:104` (Family span), and after the grid at `:115`; identical
`.kernel-caption` style.

### `+page.svelte`, stores, registry

No change. Props (`tau`, `family`, handlers) are already wired
(`+page.svelte:563-595`) and `package.json` stays at `1.4.0`.

## Expected reviewable surface

- Behavioral: `weight-family.ts` (guard + clamp helper), `token-kernel.ts`
  (clamp), `string-distance-kernel.ts` (guard), `neighborhood.ts`
  (public cap), `distance-source.ts` (params default), `trajectory.worker.ts`
  (radius guard + family in two param blocks), `neighbor-softmax.ts`
  (optional family param + clamp + logits), `neighbor-graph.ts` +
  `union-graph.ts` (resolve + pass family), `index.ts` (two exports). Small,
  localized.
- New UI/copy: `kernel-help.ts` (new, ~40 lines) plus tooltip/caption markup
  in two components and one shared style rule each.
- Tests: additions only; no existing assertions rewritten.
- Mechanical: none. No moves, renames, or reindentation expected.
- Not touched: sampling/RNG draw order, engine trajectory, schedules,
  tokenizers, docs.

## Ordered implementation steps

1. Fix `isWeightFamilyId` (`weight-family.ts`) and add its rejection tests.
2. Add `MIN_TAU`/`clampTau` (`weight-family.ts`), export from `index.ts`.
3. Fix `getStringDistanceKernel` (`string-distance-kernel.ts`) and add its
   rejection tests.
4. Fix the worker's `R_MAX_BY_KERNEL` lookup (`trajectory.worker.ts:144`).
5. Expose `NeighborhoodProvider.maxStored` (`neighborhood.ts`) and default
   `ModelDistanceSource.params.maxStored` from it (`distance-source.ts`); add
   the params test.
6. Clamp `tau` in `createTokenKernel` (`token-kernel.ts`) and add its
   $\tau = 0$ tests.
7. Add the optional `family` param and the `clampTau` call to
   `resolveNeighbors` (`neighbor-softmax.ts`); add its family and
   $\tau = 0$ tests.
8. Add `family` to `NeighborGraphParams` and thread it through
   `buildNeighborGraph` (`neighbor-graph.ts`).
9. Thread `family` through `buildUnionGraph` Pass 2 (`union-graph.ts`).
10. Populate `graphParams.family` in both worker handlers
    (`trajectory.worker.ts:265-282`, `:349-366`).
11. Add a family case to `neighbor-graph.test.ts` (and optionally
    `union-graph.test.ts`).
12. Create `kernel-help.ts` and its test.
13. Add the caption + tooltips to `LexicalParams.svelte` and
    `CharOverlapParams.svelte`.
14. Run the verification sequence.

## Tests to add

- `src/lib/strategies/weight-family.test.ts`: extend the guard block
  (`:99-110`) with `isWeightFamilyId('toString' | 'constructor' | 'hasOwnProperty')`
  all `false`, and `getWeightFamily('toString')` / `('constructor')` throw.
  Add `clampTau` cases: `clampTau(0)`, `clampTau(-1)`, `clampTau(NaN)`,
  `clampTau(Infinity)` → `MIN_TAU`; `clampTau(2) === 2`.
- `src/lib/strategies/string-distance-kernel.test.ts`: extend `:94-101` so
  `getStringDistanceKernel('toString')` and `('constructor')` throw.
- `src/lib/strategies/distance-source.test.ts`: assert
  `params.maxStored === provider.maxStored` when the provider was built with a
  finite cap, and `null` when unbounded; keep the existing identity-stability
  case passing.
- `src/lib/strategies/token-kernel.test.ts`: add a `tau: 0` case asserting
  `getRow` is finite and sums to 1 and collapses to the nearest neighbor;
  assert it matches the tiny-positive-`tau` (`MIN_TAU`) row.
- `src/lib/strategies/neighbor-softmax.test.ts`: add a `resolveNeighbors`
  case with `family: getWeightFamily('gaussian')` asserting weights equal the
  hand-computed Gaussian softmax (max-subtracted, normalized) and differ from
  the exponential run; assert the default (no family arg) equals explicit
  exponential. Add a `tau: 0` case asserting finite weights that sum to 1.
  Optionally one `power-law` case.
- `src/lib/strategies/neighbor-graph.test.ts`: add a case building the same
  graph with `family: 'gaussian'` vs the default and asserting at least one
  neighborhood edge weight changes while trajectory edges are unaffected; the
  default run must be unchanged.
- `src/lib/engine/union-graph.test.ts` (optional): mirror the above at the
  union-graph level.
- `src/lib/components/kernel-help.test.ts` (new): assert each exported copy
  has non-empty `text` and `math`, and that `katex.renderToString(math, {
  throwOnError: false })` renders without a parse error (mirrors
  `InfoTooltip.test.ts`). No DOM needed.

## Verification

Run in order:

1. `npm run check`
2. `npm run lint`
3. `npx prettier --check .` (or `npm run format` to fix)
4. `npm run test`

All pre-existing `neighbor-softmax`, `neighbor-graph`, `union-graph`,
`lexical`, `char-overlap`, `weight-family`, `string-distance-kernel`,
`neighborhood`, `distance-source`, `token-kernel`, `trajectory`, `registry`,
and `InfoTooltip` tests must pass without edits to their existing assertions.
Any failure signals an unintended behavior change and must be investigated,
not refreshed. Also manually open the app, toggle Advanced, and confirm the
τ/Family tooltips and kernel caption render for both lexical and char-overlap,
and that the `?` buttons do not disturb the sliders/selects.

## Edge cases, risks, out-of-scope, open blocking questions

Edge cases and risks:

- **Bit-identity.** Exponential `logWeight(d, τ) = -d/τ` is the exact legacy
  logit; with the default family, `resolveNeighbors` output is unchanged, so
  every existing graph/trajectory test must pass. This is the guard.
- **`clampTau` only bites for `tau <= MIN_TAU`.** Normal UI values
  (`>= 0.05`) are untouched; `tau = 0` now collapses to the nearest neighbor
  instead of producing `NaN`.
- **`params.maxStored` normalization.** A provider built without a cap has
  `maxStored = Infinity`; the source records `null` (documented as
  unbounded), preserving the `DistanceSource.params` contract.
- **`Object.hasOwn`.** Standard in the target (Node 22 CI, modern browsers).
  If the TS lib target rejects it, fall back to
  `Object.prototype.hasOwnProperty.call(map, id)`.
- **`Object.hasOwn(x, id)`** does not change the runtime type of the indexed
  value under `noUncheckedIndexedAccess`; the `!` on the return is required.
- **Optional `family` field** keeps existing `NeighborGraphParams` literals
  in tests compiling and defaults to exponential.
- **Tooltip inside `<label>`.** The `?` is a `<button>` (interactive
  content); per HTML it does not activate the labelled control, so sliders
  should be unaffected. Verify manually; if a control is disturbed, move the
  `InfoTooltip` outside the `<label>` as a sibling.
- **KaTeX strings** must be valid; `InfoTooltip` silently falls back on parse
  error, so a broken string would render messily rather than throw. The
  `kernel-help.test.ts` KaTeX render check catches this.
- **No version bump** in round 2 (`package.json` stays `1.4.0`).
- **No sampling change**, so the RNG draw-order contract
  (`engine/README.md`) is untouched.

Out of scope:

- Persistent IndexedDB caching and disconnected-graph diagnostics (round-1
  deferrals, unchanged).
- Porting `identity`/`absorbing` onto the kernel.
- Per-family tooltips in the strategy picker; tooltips for the older controls
  (Top-k, Max distance, Floor ε); updates to `LEXICAL_INFO`/`CHAR_OVERLAP_INFO`
  tooltip maths; `DESIGN.md`/`docs/libraries.md`/`AGENT_CONTEXT.md` updates.
- The review "open questions" beyond N1–N4 were resolved by the fixes above
  (family-aware edges, own-property guard, real `maxStored`).

Open blocking question:

- None. N1–N4 and the UI explanations are all in scope by explicit human
  instruction.