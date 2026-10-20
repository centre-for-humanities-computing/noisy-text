# Strategies

## How to add a new strategy

1. Create `src/lib/strategies/<name>.ts` exporting a `StrategyFactory`
   that takes a config object and `vocabSize` and returns a `NoiseStrategy`.
2. Add an entry to `STRATEGIES` in `registry.ts` with a unique kebab-case
   `id`, a human-readable `label`, a short `description`, and a
   `stationary` behavior (`'uniform'`, `'point-mass'`, `'data-dependent'`,
   or `'unknown'`).
3. Register the factory in `STRATEGY_FACTORIES` in `registry.ts`, keyed
   by the same `id`.
4. Add a test in `registry.test.ts` verifying the new id exists and its
   metadata is well-formed. Add strategy-specific tests for `sampleStep`
   and `getLocalDistribution` in a `<name>.test.ts` file next to the
   strategy.
5. The new strategy is automatically available in the picker UI — no UI
   changes needed.

## Rules

- Strategies must not import from `../schedules`, `../workers`, or
  `../stores`. They are pure functions that transform tokens.
- `sampleStep(token, beta, rng)` implements a coupled random walk step:
  $x_{t+1} \sim Q_t(\cdot \mid x_t)$ where $\beta$ is the per-step noise
  rate resolved by the engine from the schedule.
- `getLocalDistribution(token, beta)` is optional; when implemented, it
  returns a `Float32Array` probability vector of length `vocabSize`.
- The full $K \times K$ transition matrix is never materialized.
- All math in comments uses `$...$` / `$$...$$`.

## Current strategies

| id              | description                                                                                                                                                                                                            | stationary       |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `absorbing`     | Each non-mask token becomes [MASK] with prob βₜ; once masked, stays masked.                                                                                                                                            | `point-mass`     |
| `char-overlap`  | Tokens jump to tokens with similar character sets (Jaccard), plus uniform floor.                                                                                                                                       | `data-dependent` |
| `embedding-knn` | Tokens jump to semantically-similar tokens (LM embedding-space kNN), plus an optional uniform floor. Its provider is embedding-backed (`src/lib/embeddings/`): neighbourhoods are top-$M$ by metric, not radius-based. | `data-dependent` |
| `identity`      | No noise; every token stays as itself. Hidden behind the debug toggle.                                                                                                                                                 | `point-mass`     |
| `lexical`       | Tokens jump to spelling-similar tokens (edit distance), plus uniform floor.                                                                                                                                            | `data-dependent` |
| `uniform`       | Each token independently samples uniformly from the vocab with prob βₜ.                                                                                                                                                | `uniform`        |

`neighbor-softmax.ts` holds the shared softmax + ergodicity-floor pipeline for
neighbourhood-based strategies. `registry.ts` is the source of truth for ids
and metadata.
