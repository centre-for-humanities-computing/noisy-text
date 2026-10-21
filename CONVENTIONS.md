# Conventions

Concrete rules for this repo. If a rule is missing here and you had to
guess, propose adding it. `AGENTS.md` is the entry point for agents; this
file holds the detailed code rules.

## File layout

```
src/
  lib/
    strategies/       # NoiseStrategy implementations, one per file
    schedules/        # Schedule implementations, one per file
    tokenizers/       # Tokenizer adapters
    workers/          # Web Worker entry points and message protocols
    engine/           # Trajectory sampling, caching, RNG
    components/       # Svelte components
    stores/           # Svelte stores (reactive state)
  routes/             # SvelteKit routes
docs/                 # Long-form docs; NOT auto-included in agent context
```

Per-directory `README.md` files describe how to add a new entry to that
directory. Read them before adding files.

## TypeScript

- `strict: true` in `tsconfig.json`. No exceptions.
- No `any`. Use `unknown` and narrow, or define the type.
- `console` only via `warn`/`error`; no `console.log` in committed code.
- Interfaces over type aliases for object shapes.
- Discriminated unions for variant data (e.g., strategy configs).
- Exported functions and types get explicit return types. Internal ones
  may be inferred.

## Numerics

- Probability vectors: `Float32Array`.
- Token IDs: `Int32Array` for arrays, `number` for scalars.
- Never use `number[]` for hot paths.
- RNG: always inject a seeded RNG, never use `Math.random()` directly
  in engine code. Components may use it for trivial UI things.

## Strategies

A `NoiseStrategy` lives in `src/lib/strategies/<name>.ts` and is
registered in `src/lib/strategies/registry.ts` (`index.ts` only re-exports).
The canonical example is `identity.ts` — follow its shape.

Every strategy must:

- Implement `sampleStep(token, beta, rng) -> token`.
- Declare its config schema (a typed object).
- Declare its stationary-distribution behavior: `'uniform'`,
  `'point-mass'`, `'data-dependent'`, or `'unknown'`.
- Optionally implement `getLocalDistribution(token, beta)` for the inspector.

Strategies must not import schedules, workers, or stores. They are pure.

## Schedules

A `Schedule` lives in `src/lib/schedules/<name>.ts` and exposes:

- `beta(t: number) -> number`
- `cumulative(t: number) -> number` when closed-form,
  otherwise compute by accumulation in the engine.

Schedules are independent of strategies. Any pairing must work.

## Workers

- One worker per concern (sampling, neighbor precomputation, etc.).
- Message protocol typed in a shared `*.protocol.ts` file.
- Use `Comlink` if message-passing gets non-trivial; otherwise raw
  `postMessage` is fine.
- Workers post progress for long-running tasks (>1s).

## Svelte

- Stores in `src/lib/stores/`, one store per concern.
- Components are dumb where possible: props in, events out.
- No business logic in `.svelte` files beyond formatting and event wiring.
- Use `$derived` and `$state` (runes), not legacy reactive syntax.

## Tests

- `vitest`. Tests next to the code.
- Run with `npm run test` (node environment; no jsdom). Single file:
  `npx vitest run src/lib/engine/trajectory.test.ts`.
- Property tests for math: every strategy gets a test verifying its
  stationary-distribution claim empirically over a small vocab.
- Algorithmic code (selection/heaps, union-find, indexing, kernels,
  quantization) gets a seeded randomized differential test against a naive
  reference implementation in the same slice, not only hand-picked cases.
- Snapshot tests are banned for anything math-related (they hide drift).
- Don't test trivial getters or constructors.

## End-to-end smoke tests

- Playwright, local only: `npm run e2e` builds and previews on port 4173.
  Install the browser once with `npx playwright install chromium`. CI does not
  run E2E.
- Every issue that changes user-visible behavior adds `e2e/<slug>.spec.ts`
  with 3–5 smoke steps, each written as `action → observable result`.
- Select elements with stable `data-testid` attributes, not CSS classes or
  visible text. Add a test id in the same slice as the UI change.
- Strategies that need remote assets are skipped until a fixture exists; do
  not weaken assertions to make the suite green.

## Caching and persistence

- IndexedDB for precomputed tables (neighbor lists, etc.). Key by
  `(tokenizerId, paramHash)`.
- In-memory cache for trajectories, keyed by
  `(inputHash, strategyId, strategyParams, scheduleId, T, seed)`.
- Cache invalidation: explicit, never time-based.

## Dependencies

Pin major versions in `package.json` (`^x.y.z`, not `>=`).
Document any non-obvious library API in `docs/libraries.md` so we don't
re-hallucinate it next session.

Current pins worth knowing:

- `@huggingface/transformers` ^3.8.1: tokenizer-only usage, no inference.
  API notes in `docs/libraries.md`.
- `seedrandom` ^3.0.5: seeded PRNG; Alea algorithm, `'\0'`-terminated seeds.
- `katex` ^0.18.7: math rendering in tooltips and panels.

## Naming

- Files: `kebab-case.ts`.
- Types and interfaces: `PascalCase`.
- Functions and variables: `camelCase`.
- Constants: `SCREAMING_SNAKE_CASE` only for genuine compile-time constants.
- Strategy and schedule IDs: `kebab-case` strings (`'mask'`, `'lexical-edit'`).

## Commits

- Conventional commits: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`.
- Reference issue numbers: `feat(#7): implement mask strategy`.
- One slice per commit, one idea per slice. Behavioral slices are ≤400 changed
  lines (target ≤250); mechanical slices are ≤150. Never mix the two.
- Body of 3–5 lines for the reviewer: what the slice does, why, and how it was
  verified. End with trailers on their own lines:

  ```
  Slice: S<k>/<total>
  Kind: behavioral|mechanical
  ```

  A split slice uses `Slice: S<k>a/<total>`. Mechanical slices cover moves,
  renames, reindentation, barrels (`index.ts`), docs, types-only files, and
  the version bump.

## Versioning

`package.json` follows SemVer and is bumped once per issue, in the final
mechanical slice of round 1 (see `.ai/README.md` for the round layout):

- breaking change (`feat!` / `BREAKING CHANGE:`) → major
- `feat` → minor
- `fix`, `perf`, `refactor`, `docs`, `test`, `chore` → patch

The bump must match the issue's highest commit type; when an issue mixes types,
use the highest. It is committed as `chore(#<n>): bump version to <x.y.z>`.
Later review-round commits on the same issue do not bump again. History is
inconsistent — follow this table, not precedent.
