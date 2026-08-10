# Workers

Web Worker entry points and message protocols.

## How to add a new worker

1. Create `src/lib/workers/<name>.protocol.ts` with typed request/response
   discriminated unions.
2. Create `src/lib/workers/<name>.worker.ts` with `/// <reference lib="webworker" />`
   at the top. Import pure functions from `$lib/engine/` — do not import
   stores, components, or tokenizers.
3. Workers construct their own strategy/schedule instances from ids and
   configs. No closures cross the worker boundary.
4. Transfer `ArrayBuffer`s via `postMessage(msg, { transfer: [...] })`.
5. Post progress for long-running tasks (>1s).

## Current workers

| file                   | purpose                                      |
| ---------------------- | -------------------------------------------- |
| `trajectory.worker.ts` | Compute coupled trajectory $x_0 \ldots x_T$. |
