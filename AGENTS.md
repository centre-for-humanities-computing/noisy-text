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
npm run check            # svelte-check typecheck
npm run lint             # eslint
npx prettier --check .   # CI enforces; npm run format fixes
npm run test             # vitest, node environment (no jsdom)
npm run e2e              # Playwright smoke, local only (build + preview on :4173)
node scripts/slice-check.mjs --budget 400   # per-slice gate: check/lint/format/test + size
npx vitest run src/lib/engine/trajectory.test.ts   # single file
npx vitest run -t "is deterministic for the same seed"  # single test by name
```

CI (Node 22, push/PR to `main`) runs `check` → `lint` → `prettier --check` →
`build` → `test`. E2E is not in CI (browser download cost).

Per-slice verification: `node scripts/slice-check.mjs --budget <slice budget>`
(runs `npm run check` → `lint` → `format` → `test`, stages, and reports the
changed-line count; exit 2 means split the slice). Per round, before pushing,
run `npm run test` once more and, if the plan has `## Smoke steps`,
`npm run e2e` (first time: `npx playwright install chromium`).

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
- **Slices are commits.** One idea per commit: behavioral ≤400 changed lines
  (target ≤250), mechanical ≤150, never mixed. Each commit carries `Slice:` and
  `Kind:` trailers; over-budget slices split into `S<k>a`, `S<k>b`, …
- **Algorithmic code gets a seeded randomized differential test** against a
  naive reference implementation in the same slice (selection/heaps,
  union-find, indexing, kernels, quantization) — not only hand-picked cases.
- Conventional commits with issue number (`feat(#7): ...`); bump
  `package.json` once per issue (final mechanical slice of round 1) per SemVer
  (breaking → major, `feat` → minor, otherwise patch — `CONVENTIONS.md`);
  one issue per session.

## Workflow and handoffs

`draft → refine → plan → implement → review → merge`. Humans confirm plans
before `/implement` and decide the merge; `/implement` commits and opens the
PR itself. Every task starts in a fresh session. Use the slash commands
`/refine`, `/plan`, `/implement`, `/review`; artifacts live in
`.ai/<issue-number>-<slug>/round-N/`. The reviewer writes `review.json`;
`scripts/review-pack.mjs` validates it and generates the `review.md` comment
body and a local `review.html`, and the reviewer posts the comment. Review
reports are PR comments marked `<!-- noisy-text-review: round=N -->` (the
generated files are gitignored). Repeated plan → implement → review rounds run
on the same branch and PR: a non-approve review verdict leads to a revision
plan for the next round, with no round cap; after `approve with nits`,
`/plan <issue> next` starts an explicit revision round. One commit per slice
(`Slice:`/`Kind:` trailers), on the same branch and PR; `package.json` is
bumped once per issue. `/plan` enforces a round-1 size gate (≤1200 changed
lines unless `large` is passed) and creates or checks out the issue branch;
`/implement` refuses to run on a different branch. `/plan` and `/review` run on
the read-only `plan` agent; the `plan-writer`, `reviewer`, and `slice-reviewer`
subagents perform the only writes (the `.ai/` artifacts). Refined issues live
on GitHub, not in `.ai/`; `/refine` is the escape hatch when a review shows the
issue scope itself is wrong. See `.ai/README.md` and `.opencode/command/`.

## Context discipline

- Delegate repo exploration to the `explore` subagent before reading files
  yourself; ask for `file:line` answers, not file dumps.
- `grep`/`glob` first; read only the needed range.
- Don't re-read files already seen in this session; don't paste long outputs.
- Compress or summarize finished exploration before starting new work.
