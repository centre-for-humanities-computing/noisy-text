# Diff report: Issue #63 — Update opencode setup for the project

Branch: `63-update-opencode-setup-for-the-project`. Covers the committed
baseline `56811db` plus the uncommitted review follow-up. Verification order:
`check → lint → format → test` (plus `prettier --check`, JSON validation,
build).

## Committed baseline (`56811db`)

### New files

- `AGENTS.md` — compact always-loaded entry point: read-only-what-you-need
  doc table, commands, per-issue verification order, non-negotiables,
  workflow/handoff map, context discipline. Replaces
  `.github/copilot-instructions.md` as the agent entry point.
- `opencode.json` — project config. Overrides the built-in `plan` agent:
  `edit` denied except `.ai/**` (also `**/.ai/**` fallback). Sets `explore`
  subagent model to glm-5.3-flash.
- `.opencode/agent/reviewer.md` — read-only adversarial reviewer subagent
  (deepseek-v4.1-flash).
- `.opencode/command/refine.md` — `/refine` (deepseek-v4.1-flash): draft → refined
  GitHub issue text (may split); prints suggested `gh` commands; no `.ai/`
  files.
- `.opencode/command/plan.md` — `/plan` (deepseek): branch prep, explore via
  subagent, plan artifact.
- `.opencode/command/implement.md` — `/implement` (glm-5.3-flash): implements the plan
  exactly, version bump, `check → lint → format → test`, diff report.
- `.opencode/command/review.md` — `/review` (deepseek): delegates to the
  `reviewer` subagent.
- `.ai/README.md` — handoff-file conventions: per-issue layout, branch naming
  (created by `/plan`, verified by `/implement`), human gates, refined issues
  live on GitHub.
- `.ai/63-update-opencode-setup-for-the-project/plan.md` — this issue's
  approved plan (dogfooding the new workflow).

### Changed and deleted files

- `.github/copilot-instructions.md` — deleted (115 lines). Unique rules merged
  into `AGENTS.md`; stale `GLOSSARY.md` pointer removed.
- `AGENT_CONTEXT.md` — non-goals: replaced the "Revised by DESIGN.md §9" note
  with a clean statement; feature list refreshed (GPT-2/BERT tokenizers; five
  strategies + debug identity; prose/chips/graph; hover inspector + neighbour
  graph; diagnostics/token-drop/side-by-side marked future).
- `CONVENTIONS.md` — intro points to `AGENTS.md` as the agent entry point;
  dependency pins replaced the placeholder (transformers ^3.8.1, seedrandom
  ^3.0.5, katex ^0.18.7); test commands added.
- `DESIGN.md` — title note points agents to `AGENTS.md`/`.ai/README.md` and
  §10; §9 action item marked done.
- `README.md` — added an "Agent workflow" section pointing to `AGENTS.md` and
  `.ai/README.md`.
- `src/lib/strategies/README.md` — strategy table updated from 3 stale rows to
  all 5 (`absorbing`, `char-overlap`, `identity`, `lexical`, `uniform`) with
  correct `stationary` values; note on `neighbor-softmax.ts` and `registry.ts`
  as source of truth.
- `package.json` — version `1.1.0` → `1.2.0` (feat).

## Review follow-up (uncommitted)

- `.prettierignore` — `.ai/` added. Fixes B1; artifacts are prose written after
  the format step and stay committed and human-readable.
- `.opencode/agent/reviewer.md` — edit allowed only under `.ai/**`; bash
  allowlist for read-only `git`/`gh`/`npm`/`npx` commands with explicit denies
  for `npm run format`, `git commit`, `git push`; writes `review.md` itself;
  output format per `.ai/README.md` (no tables).
- `.opencode/agent/plan-writer.md` — new transcription-only subagent so
  `/plan` can persist its artifact despite the read-only `plan` mode.
- `.opencode/command/plan.md` — main agent composes the plan in chat (plan
  mode forbids edits), `plan-writer` writes it, main agent reads it back and
  re-delegates on drift; artifact-style reference.
- `.opencode/command/implement.md` — commits, pushes, and runs `gh pr create`
  itself; SemVer reference; diff-report style; never merges.
- `.opencode/command/review.md` — reviewer writes the report; artifact-style
  reference; still `agent: plan` deliberately (read-only main loop).
- `.ai/README.md` — `## Artifact style` section (headings and bullets, no
  tables, ~80 columns) plus the subagent write-model note.
- `AGENTS.md` — SemVer pointer to `CONVENTIONS.md`; workflow line updated
  (auto PR; read-only `/plan` and `/review` with subagent writers);
  single-test example fixed (N3).
- `CONVENTIONS.md` — `## Versioning` table (N4 follow-up: `console` rule added
  under TypeScript; N5: registry path fixed to `registry.ts`).
- `.ai/63-update-opencode-setup-for-the-project/plan.md` — restructured to
  headed bullets; review follow-up amendment.
- `.ai/63-update-opencode-setup-for-the-project/diff-report.md` — this file,
  restructured to headed bullets.
- `.ai/63-update-opencode-setup-for-the-project/review.md` — first review
  report, restructured to the artifact style.

## Verification results

Current working tree (baseline + follow-up):

- `npm run check` — 0 errors, 0 warnings.
- `npm run lint` — passed.
- `npm run format` — applied; no file changed.
- `npm run test` — 26 files / 334 tests passed.
- `npx prettier --check .` — all matched files use Prettier code style
  (`.ai/` ignored).
- `npm run build` — built and wrote the static site (extra CI-parity check).
- `opencode debug agent plan-writer` — edit denied except `.ai/**`; bash
  denied.
- `opencode debug agent reviewer` — `.ai/**` edit allow; bash
  allowlist/denies as specified.
- `opencode.json` JSON parse — valid.

## Notes

- `.gitignore` unchanged; `.ai/` is committed intentionally.
- Restart opencode to load `opencode.json`, agent, and command changes.
- Baseline `56811db` is committed; follow-up changes are uncommitted and no PR
  exists yet.
- `opencode run` does not enforce permission rules (non-interactive
  auto-approve), so live probes prove capability only; `opencode debug agent`
  is the static check for what the TUI will enforce.
