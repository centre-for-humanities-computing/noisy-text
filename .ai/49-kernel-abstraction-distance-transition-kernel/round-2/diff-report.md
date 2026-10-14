- Round: 2
- Commits: fix(#49): harden kernel guards, clamp tau, thread family into graphs, explain kernel settings (round 2)

## Summary

Round 2 closes all four round-1 review findings (N1–N4) and adds the
user-facing explanations for the new kernel settings. N1: id lookups
(`isWeightFamilyId`, `getWeightFamily`, `getStringDistanceKernel`, and the
worker's radius table) now use `Object.hasOwn` own-property checks, so
`Object.prototype` keys like `'toString'` are rejected with the intended
"Unknown …" error instead of blessing an inherited member. N2: the tooltip
neighborhood graph and the union graph now weight their neighborhood edges
with the *selected* weight family (threaded via an optional
`NeighborGraphParams.family`, defaulting to exponential so the default path is
bit-identical to round 1). N3: `NeighborhoodProvider.maxStored` is now public
and `ModelDistanceSource.params.maxStored` defaults to it, so the real path
reports `200` instead of `null` (non-finite caps normalize to `null`). N4:
`tau` is clamped to a small positive floor (`MIN_TAU = 1e-6`) in both
`createTokenKernel` and `resolveNeighbors`, so `tau = 0` collapses to the
nearest neighbor instead of producing `NaN`. On top of the fixes, a new
`kernel-help.ts` supplies a plain-language caption plus `?` tooltips (text
first, KaTeX second) for τ, the weight family, and the kernel itself, rendered
in both `LexicalParams` and `CharOverlapParams`. No version bump (round-2
rule); `package.json` stays at 1.4.0.

## Reading order

Start with `src/lib/strategies/weight-family.ts` (the guard fix plus the new
`MIN_TAU`/`clampTau` pair — everything else depends on it), then
`src/lib/strategies/neighbor-softmax.ts` (family parameter + clamp feeding
both graph builders), then `src/lib/engine/union-graph.ts` +
`src/lib/strategies/neighbor-graph.ts` (the family threading), then
`src/lib/workers/trajectory.worker.ts` (guard + family wiring on the real
path). The UI copy files are low-risk; the test files are additions only.

## Per-file notes

- `src/lib/strategies/weight-family.ts` — **behavioral.** `isWeightFamilyId`
  switched from `id in WEIGHT_FAMILIES` to `Object.hasOwn(WEIGHT_FAMILIES, id)`
  (N1). Added `MIN_TAU = 1e-6` and `clampTau` exactly as planned. Map to plan
  §`weight-family.ts`.
- `src/lib/strategies/token-kernel.ts` — **behavioral.** `createTokenKernel`
  no longer destructures `tau` from params; it computes `const tau =
  clampTau(params.tau)` once, so the row softmax and `logWeight` use the
  clamped value (N4). Imports `clampTau`.
- `src/lib/strategies/string-distance-kernel.ts` — **behavioral.**
  `getStringDistanceKernel` now guards with `!Object.hasOwn(...)` instead of a
  truthy lookup (N1); returns via `!` indexing as planned.
  `stringDistanceKernelFor` untouched.
- `src/lib/strategies/neighborhood.ts` — **behavioral (visibility only).**
  `_maxStored` renamed to a public readonly `maxStored`; constructor and
  `neighborsOf` updated; class doc mentions the public cap (N3). No logic
  change.
- `src/lib/strategies/distance-source.ts` — **behavioral.** Constructor
  defaults `params.maxStored` to `provider.maxStored` and normalizes
  non-finite to `null` (N3); options doc updated. Map to plan
  §`distance-source.ts`.
- `src/lib/workers/trajectory.worker.ts` — **behavioral.** Radius lookup in
  `ensureDistanceSourceProvider` is an `Object.hasOwn` check on
  `R_MAX_BY_KERNEL` (N1); both `handleNeighbors` and `handleUnionGraph` widen
  the config cast with `family?: WeightFamilyId` and set
  `family: cfg.family ?? 'exponential'` in `graphParams` (N2). New type
  import.
- `src/lib/strategies/neighbor-softmax.ts` — **behavioral.**
  `resolveNeighbors` gains an optional fifth `family` parameter defaulting to
  `getWeightFamily('exponential')`; logits now use `family.logWeight(dist,
  clampTau(tau))`; doc comment updated to $w_m = w_\tau(d_m)$ (N2 + N4).
  Exponential default keeps the legacy logits bit-identical.
- `src/lib/strategies/neighbor-graph.ts` — **behavioral.**
  `NeighborGraphParams` gains optional `family?: WeightFamilyId`;
  `buildNeighborGraph` resolves the family once and passes it to
  `resolveNeighbors` (N2).
- `src/lib/engine/union-graph.ts` — **behavioral.** Pass 2 of
  `buildUnionGraph` resolves `params.family ?? 'exponential'` once before the
  anchor loop and passes it to `resolveNeighbors` (N2). Import added.
- `src/lib/strategies/index.ts` — **mechanical + additive.** Re-exports
  `MIN_TAU` and `clampTau` alongside the existing weight-family exports.
- `src/lib/components/kernel-help.ts` — **new, UI copy only.** `HelpCopy`
  interface, `KERNEL_CAPTION`, `KERNEL_TOOLTIP`, `TAU_TOOLTIP`,
  `FAMILY_TOOLTIP` with the planned wording (only `*where*` emphasis dropped
  to plain words since the caption is rendered as text). Single source shared
  by both param panels.
- `src/lib/components/LexicalParams.svelte` and
  `src/lib/components/CharOverlapParams.svelte` — **behavioral markup only.**
  τ and Family label spans now embed an `InfoTooltip` (`?` button); a
  `kernel-caption` paragraph sits after the grid; identical
  `.kernel-caption` style rule (`font-size: var(--font-size-xs)`,
  `color: var(--color-text-quiet)`, `margin: 0`) in both files. Sliders,
  selects, and event wiring untouched.
- Tests (all **additions**, no existing assertions rewritten):
  `weight-family.test.ts` (inherited-key rejections for the guard and getter;
  `clampTau` pass-through/floor/boundary cases),
  `string-distance-kernel.test.ts` (inherited-key rejections),
  `distance-source.test.ts` (params default to the provider cap; `null` when
  unbounded), `token-kernel.test.ts` (`tau: 0` finite/sums-1/MIN_TAU-equal,
  nearest-neighbor collapse, `NaN` clamped),
  `neighbor-softmax.test.ts` (`tau: 0`, default ≡ explicit exponential,
  hand-computed Gaussian and power-law rows differing from exponential),
  `neighbor-graph.test.ts` (gaussian vs default graph: neighborhood weights
  change, trajectory weights don't, omitted family ≡ explicit exponential),
  and the new `kernel-help.test.ts` (non-empty copy; KaTeX renders each math
  string without a `katex-error` span, mirroring `InfoTooltip.test.ts`).

## Known limitations and residual risk

- The manual UI check from the plan's verification section (open the app,
  toggle Advanced, confirm tooltips and caption render for both strategies and
  the `?` buttons don't disturb the sliders) could not be exercised in this
  environment; automated coverage confirms the copy exists and the KaTeX
  strings parse. The tooltip-inside-`<label>` risk is mitigated by
  `InfoTooltip`'s `<button>` not activating the labelled control, but this is
  the one unverified interaction.
- `clampTau` maps exactly `MIN_TAU` to `MIN_TAU`; a caller passing a value
  between 0 and `MIN_TAU` gets the floor, matching the documented
  $\tau \to 0$ limit but not a mathematical "smallest value > 0" reading.
- Inherited-key rejection now throws the intended error for hostile ids, but
  the worker radius table (`R_MAX_BY_KERNEL`) silently falls back to `R_MAX`
  for any unknown key — by design for untrusted config, worth keeping in mind
  when adding future kernels.
- Out of scope unchanged from the plan: persistent caching, disconnected-graph
  diagnostics, porting `identity`/`absorbing` onto the kernel, per-family
  picker tooltips, doc updates.

## Verification results

Run in order on this tree, all clean:

1. `npm run check` — svelte-check: 0 errors, 0 warnings.
2. `npm run lint` — eslint clean.
3. `npm run format` (prettier) — no changes needed; `npx prettier --check .`
   passes.
4. `npm run test` — 32 files, 431 tests, all passing (two new
   float32-vs-float64 hand-computed expectations were adjusted to
   `toBeCloseTo` during verification; no pre-existing assertion was edited).
