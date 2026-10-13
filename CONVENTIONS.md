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
- Snapshot tests are banned for anything math-related (they hide drift).
- Don't test trivial getters or constructors.

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
- One logical change per commit.

## Versioning

`package.json` follows SemVer and is bumped once per issue, in the round-1
commit (see `.ai/README.md` for the round layout):

- breaking change (`feat!` / `BREAKING CHANGE:`) → major
- `feat` → minor
- `fix`, `perf`, `refactor`, `docs`, `test`, `chore` → patch

The bump must match the commit type; when an issue mixes types, use the highest.
Later review-round commits on the same issue do not bump again. History is
inconsistent — follow this table, not precedent.
