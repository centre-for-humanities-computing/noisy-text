# Engine

Trajectory sampling, caching, and RNG.

## How to add a new engine capability

1. Create `src/lib/engine/<name>.ts` with pure functions (no side effects,
   no DOM, no workers).
2. Add tests in `<name>.test.ts` next to the implementation.
3. If the capability is used by a worker, import it in the worker file
   (workers may import from `$lib/engine/`).

## RNG draw order contract

The trajectory sampler draws from the RNG in a fixed order:

1. Outer loop: $t \in [0, T)$ (timestep).
2. Inner loop: $i \in [0, L)$ (position).
3. Exactly one `sampleStep` call per $(t, i)$ cell.

**Changing this order changes every trajectory for a given seed.** Any
refactoring of `computeTrajectory` must preserve this order or update
the contract and all dependent tests.

## Cache key format

```
${inputHash}:${strategyId}:${strategyConfigJson}:${scheduleId}:${scheduleConfigJson}:${T}:${seed}
```

- `inputHash` is FNV-1a 32-bit of the `Int32Array` token ids.
- Config objects are `JSON.stringify`'d — they must be JSON-serializable.
- Cache is FIFO with `MAX_CACHE_ENTRIES = 8`.

## Memory guard

`MAX_CELLS = 8_000_000` (~32 MB at 4 bytes/cell). `computeTrajectory`
throws if $(T+1) \times L$ exceeds this. Reduce $T$ or input length to
stay under the limit.
