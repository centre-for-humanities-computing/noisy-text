# Round 1 diff report — kernel abstraction (distance → transition kernel)

Branch: `49-kernel-abstraction-distance-transition-kernel`
Commit: `feat(#49): factor distance strategies onto a shared kernel abstraction (round 1)`

## What was implemented (per round-1 plan)

New modules in `src/lib/strategies/`:

1. **`weight-family.ts`** — `WeightFamilyId` (`'exponential' | 'power-law' | 'gaussian'`),
   `WeightFamily { id, label, weight(dist, tau), logWeight(dist, tau) }`, `WEIGHT_FAMILIES`,
   `getWeightFamily` (throws on unknown), `isWeightFamilyId` guard.
   - exponential $w = \exp(-d/\tau)$ (legacy softmax, `logWeight` computed directly as $-d/\tau$
     for bit-identity), power-law $w = (1+d)^{-1/\tau}$ (shifted base — finite at $d=0$,
     correct $\tau$ limits; documented in source), gaussian $w = \exp(-d^2/(2\tau^2))$.
2. **`distance-source.ts`** — `NeighborTable { ids: Int32Array, dists: Float32Array }`,
   `DistanceSource` interface, `ModelDistanceSource(model, provider, opts?)`:
   `id = model.id`, `params = { rMax, maxStored }`, `vocabSize = model.K`,
   `topK(tokenId, k, maxDistance)` (skip self, keep $d \le$ maxDistance, cap at $k$),
   `distance(a,b)` delegates to `provider.model.distance(a, b, provider.R_MAX)`.
3. **`token-kernel.ts`** — `KernelRow`, `TokenKernel` (exactly 1 rng draw in `sampleStep`),
   `KernelParams`, `createTokenKernel` (memoized sparse rows, log-space max-subtracted softmax
   over `family.logWeight`, $\varepsilon$ floor folded into `sampleStep` via
   $\lfloor \text{draw}/\varepsilon \cdot K \rfloor$ then inverse-CDF over
   $v = (\text{draw}-\varepsilon)/(1-\varepsilon)$), `createUniformKernel`,
   `kernelRowToDense`.
4. **`kernel-strategy.ts`** — `createKernelStrategy<Config>`: shared strategy body.
   `sampleStep` draws exactly **2** rng values in **every** branch (stay included — legacy
   contract pinned by `lexical.test.ts`/`uniform.test.ts`); on a kernel jump the pre-drawn
   second value is handed to the kernel through a one-shot `Rng` wrapper.
   `getLocalDistribution` reuses a single `Float32Array` and returns the floor-mixed jump row.
5. **`string-distance-kernel.ts`** — `StringDistanceKernel { id, stringFn, distanceFn,
   makeModel }`, `STRING_DISTANCE_KERNELS`, `getStringDistanceKernel`,
   `stringDistanceKernelFor(mode)`. Testable string-level composition
   ($d_{\text{model}}(a,b) = \text{distanceFn}(\text{stringFn}(a), \text{stringFn}(b))$);
   hot-path candidate indexing stays in the `DistanceModel` implementations.

Ports:

6. **`lexical.ts`** — `LexicalConfig.family?: WeightFamilyId` (default `'exponential'`);
   factory = `ModelDistanceSource` → `createTokenKernel` → `createKernelStrategy`.
   `LEXICAL_INFO` unchanged.
7. **`char-overlap.ts`** — same shape; `mode` still consumed by the worker for the
   string-distance kernel id.
8. **`uniform.ts`** — `sampleStep` jump branch now delegates to
   `createUniformKernel(vocabSize, 0).sampleStep` (identical draw/index math); beta-aware
   `getLocalDistribution` unchanged.
9. **`neighborhood.ts`** — `private _model` → `readonly model: DistanceModel`.
10. **`registry.ts`** — `strategyConfigFor` lexical/char-overlap branches add
    `family: _extra?.family ?? 'exponential'`.
11. **`index.ts`** — barrel re-exports all new public surface.
12. **`trajectory.worker.ts`** — `ensureLexicalProvider` + `ensureCharOverlapProvider`
    collapsed into `ensureDistanceSourceProvider(kernelId, tokenizerId, onProgress)` using
    `getStringDistanceKernel(kernelId).makeModel(strings)`; cache keyed
    `${kernelId}:${tokenizerId}`; `R_MAX_BY_KERNEL` keeps `R_MAX=3` (edit-distance) and
    `R_MAX_CHAR=1.0` (char-overlap); `NEIGHBOR_STORE_LIMIT` unchanged; all three call sites
    (compute / neighbors / union-graph) updated.
13. **`stores/lexical.svelte.ts` + `stores/charOverlap.svelte.ts`** — added
    `family: WeightFamilyId = $state('exponential')`, included in `params`.
14. **`LexicalParams.svelte` + `CharOverlapParams.svelte`** — added τ slider
    (0.05–5, step 0.05) and family `<select>` with `ontauchange`/`onfamilychange`.
15. **`routes/+page.svelte`** — wired τ/family props and handlers to both components.
16. **`package.json`** — 1.3.0 → 1.4.0 (round-1 bump).

## Tests

New: `weight-family.test.ts` (closed forms, monotonicity, $\tau$ limits, finite at $d=0$,
throw on unknown), `distance-source.test.ts` (self exclusion, ascending, $k$/maxDistance,
stable id/params, distance delegation), `token-kernel.test.ts` (row sums 1, no self,
top-k/maxDistance truncation, exactly 1 draw, floor branch, empty table, $\tau$ limits),
`kernel-strategy.test.ts` ($\beta=0$ identity, exactly 2 draws in all branches, kernel jump,
floor-mixed dense row), `string-distance-kernel.test.ts` (distanceFn ≡ model.distance over
small vocab, symmetric/zero self, canonical forms, model selection).

Extended: `lexical.test.ts` / `char-overlap.test.ts` add a `family: 'gaussian'` case
(hand-computed masses; explicit `'exponential'` ≡ omitted). `registry.test.ts` adds family
default + `_extra.family` cases. All pre-existing assertions unchanged and passing.

## Verification

- `npm run check` — 0 errors, 0 warnings
- `npm run lint` — clean
- `npx prettier --check .` — clean
- `npm run test` — 31 files, 408 tests, all pass (incl. lexical, char-overlap, uniform,
  neighbor-softmax, neighborhood, neighbor-graph, union-graph, trajectory)
- `npm run build` — succeeds

## Deviations from the plan

- **`kernel-strategy.sampleStep` draw order.** The plan sketch showed an early return on the
  stay branch (1 draw), which contradicts both the "exactly 2 draws" requirement and the
  legacy contract pinned by `lexical.test.ts` ("draws exactly 2 rng values (stay branch)") and
  `uniform.test.ts`. Implemented as: draw coin, draw `draw`, then branch — with the pre-drawn
  `draw` handed to `TokenKernel.sampleStep` through a one-shot `Rng` wrapper so the kernel
  still consumes exactly 1 value. This keeps every existing trajectory bit-identical for the
  default (exponential) family.
- **Empty-row + $\varepsilon>0$ sampling.** The kernel applies the $\varepsilon$ floor branch
  before the empty-row check, so an empty neighbor row maps draws through
  $\lfloor \text{draw}/\varepsilon \cdot K \rfloor$ instead of the legacy raw-draw index. Both
  are uniform over the vocab (same distribution, different draw→index mapping), so only
  empty-row cells with $\varepsilon>0$ shift indices — consistent with the plan's noted
  intentional empty-row normalization fix in `getLocalDistribution`. Existing tests (which use
  $\varepsilon=0$ for empty-row cases) pass unchanged.

## Known limitations / deferred (per plan)

- Disconnected-graph diagnostics deferred; IndexedDB persistence for the provider cache
  deferred (in-memory this round).
- `identity`/`absorbing` not ported (RNG draw contracts).
- `maxStored` truncation precedes read-time filtering (pre-existing provider behavior).
- Docs (`docs/libraries.md`, `DESIGN.md`, `AGENT_CONTEXT.md`) intentionally untouched this round.
