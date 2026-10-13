# AGENTS.md

In-browser SvelteKit + TypeScript playground visualizing forward discrete noise
processes over text (D3PM-inspired). Static site, zero server compute; all
compute runs in the browser.

## Read only what the task needs

| Need                                              | File                         |
| ------------------------------------------------- | ---------------------------- |
| Project purpose, math model, key abstractions     | `AGENT_CONTEXT.md`           |
| Code rules (TS, numerics, tests, commits)         | `CONVENTIONS.md`             |
| UX/visual design; implementation notes            | `DESIGN.md` (§10 for code)   |
| Non-obvious dependency APIs                       | `docs/libraries.md`          |
| Adding a strategy / schedule / tokenizer / worker | that directory's `README.md` |
| Workflow phases and `.ai/` handoff files          | `.ai/README.md`              |

Do not load these docs in full by default. Delegate exploration to the
`explore` subagent and open only the sections you need.

## Commands

```bash
npm run dev              # dev server, http://localhost:5173
npm run build            # static output in build/
npm run preview          # serve the built site
npm run check            # svelte-check typecheck — NOT run by CI; run it yourself
npm run lint             # eslint
npx prettier --check .   # CI enforces; npm run format fixes
npm run test             # vitest, node environment (no jsdom)
npx vitest run src/lib/engine/trajectory.test.ts   # single file
npx vitest run -t "is deterministic for the same seed"  # single test by name
```

CI (Node 22, push/PR to `main`) runs `lint` → `prettier --check` → `build` →
`test`. Type errors only surface via `npm run check`.

Per-issue verification order: `npm run check` → `npm run lint` →
`npm run format` → `npm run test`.

## Non-negotiables

These are load-bearing; breaking them silently breaks the math.

- **Coupled stepwise sampling.** $x_{t+1}$ is sampled from $x_t$; never draw
  independently from $\bar Q_t e_{x_0}$. The full $K \times K$ matrix is never
  materialized.
- **RNG draw order is a contract.** `computeTrajectory` draws $t$ outer,
  position inner, exactly one `sampleStep` per $(t, i)$ cell. Changing the order
  changes every trajectory for a given seed (`src/lib/engine/README.md`).
- **Typed arrays** (`Float32Array`, `Int32Array`) in all hot paths. Seeded
  `seedrandom.alea(String(seed) + '\0')` only (short-key hazard); never
  `Math.random()` in engine code.
- **Strategies and schedules are pure and orthogonal**, registered in
  `registry.ts`; adding one auto-wires the picker UI. Registry metadata is the
  source of truth — README tables can lag.
- **Heavy compute (>50 ms) lives in Web Workers.** Workers construct
  strategy/schedule from id + serializable config; no closures cross the
  boundary; transfer `ArrayBuffer`s. UI reads from `trajectoryStore`.
- **No new dependencies without asking** (explicitly no lodash, mathjs, d3, or
  UI kits).
- **Math in comments and docs uses `$...$` / `$$...$$`.** Write the math comment
  before implementing any sampling or transition code.
- `strict` + `noUncheckedIndexedAccess`; no `any`, no `@ts-ignore` without a
  comment saying why. `console` only via `warn`/`error`.
- Tests live beside code as `foo.test.ts`; no snapshot tests for math.
- Conventional commits with issue number (`feat(#7): ...`); bump
  `package.json` once per issue (round-1 commit) per SemVer
  (breaking → major, `feat` → minor, otherwise patch — `CONVENTIONS.md`);
  one issue per session.

## Workflow and handoffs

`draft → refine → plan → implement → review → merge`. Humans confirm plans
before `/implement` and decide the merge; `/implement` commits and opens the
PR itself. Every task starts in a fresh session. Use the slash commands
`/refine`, `/plan`, `/implement`, `/review`; artifacts live in
`.ai/<issue-number>-<slug>/round-N/`. Repeated plan → implement → review
rounds run on the same branch and PR: a non-approve review verdict leads to a
revision plan for the next round, with no round cap; `package.json` is bumped
once per issue. `/plan` creates or checks out the issue branch;
`/implement` refuses to run on a different branch. `/plan` and `/review` run on
the read-only `plan` agent; the `plan-writer` and `reviewer` subagents perform
the only writes (the `.ai/` artifacts). Refined issues live on GitHub, not in
`.ai/`; `/refine` is the escape hatch when a review shows the issue scope
itself is wrong. See `.ai/README.md` and `.opencode/command/`.

## Context discipline

- Delegate repo exploration to the `explore` subagent before reading files
  yourself; ask for `file:line` answers, not file dumps.
- `grep`/`glob` first; read only the needed range.
- Don't re-read files already seen in this session; don't paste long outputs.
- Compress or summarize finished exploration before starting new work.
