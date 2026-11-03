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

## Context discipline

- Delegate repo exploration to the `explore` subagent before reading files
  yourself; ask for `file:line` answers, not file dumps.
- `grep`/`glob` first; read only the needed range.
- Don't re-read files already seen in this session; don't paste long outputs.
- Compress or summarize finished exploration before starting new work.

<!-- omhu:begin -->

## How agents work here

- **Prompts are static text.** No `{{placeholders}}`, no rendering step. Project
  facts live in `AGENTS.md`; numbers that scripts enforce live in one small JSON
  config read only by scripts.
- **The issue is the plan.** Walk notes and plans are marked comments on the
  forge issue; there are no plan files and no round folders.
- **No litter.** The durable record is the issue, the PR, the commits with
  `Plan:` / `Slice:` / `Fixes:` / `Kind:` trailers, and the three soil files.
- **Soil is edited in place.** `.omhu/MAP.md`, `.omhu/JOURNAL.md`,
  `.omhu/COMPOST.md` and this file change in the issue's last slice, as a diff
  you can read.
- **Short prompts.** Prompts should be as concise as they can be; when a cheap
  model fails a step, move it into a script or a check rather than into more
  prose.
- **Agents are permission shapes, not commands.** `/cultivate` uses `cultivator`,
  `/dream` uses `dreamer`, `/walk` and `/plan` share `planner`, `/implement` runs
  as `build`, `/review` uses `reviewer`, `/reflect` and `/retrospective` share
  `reflector`, and `/tend` uses `gardener`.
- **Prompts match permissions.** A command's prompt names the shell commands its
  agent may run, so the first attempt is not a denial; keep the allow list and
  the prose aligned.
- **Steps are optional.** `/walk`, `/plan` and `/review` are recommended, and the
  human picks which ones an issue gets. An agent asked to skip ahead skips, says
  which step it skipped in one line, and never runs a step nobody asked for.
- **`/implement` writes the noticed entry, `/retrospective` the rest of the soil.**
  Every phase opens from the newest artefact's unanswered questions.
- **Secrets stay out of context.** All forge access goes through
  `scripts/forge.mjs`; never read or print `.secrets/`.
- **Long sessions can prune.** The workflow agents allow DCP's `compress` tool
  after their default-deny rule; commands inherit their agent's permissions.

## Stance

This is a hobby/research project maintained in spare hours by one person.

- Think before coding: state the assumption and the smallest change.
- Change surgically: touch only what the task needs, not its neighbours.
- Before planning, state the smallest version that delivers the goal and what it
  leaves out. Prefer deleting or reusing code to adding it.
- Do not add tests for states the code cannot reach, differential tests for
  trivial parsing, guards for impossible input, or docs nobody asked for.
- Report net lines (added and deleted).
- If an idea is good but not needed now, add a short entry to `.omhu/COMPOST.md`
  instead of building it: a sentence or two on one line, no continuation lines.

<!-- omhu:end -->
