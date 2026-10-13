# Diff report: Issue #63 — Update opencode setup for the project

Branch: `63-update-opencode-setup-for-the-project`. Verification order:
`check → lint → format → test` (plus `prettier --check`, JSON validation,
build).

## New files

| File                                        | What / why                                                                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AGENTS.md`                                 | Compact always-loaded entry point: read-only-what-you-need doc table, commands, per-issue verification order, non-negotiables, workflow/handoff map, context discipline. Replaces `.github/copilot-instructions.md` as the agent entry point. |
| `opencode.json`                             | Project config. Overrides built-in `plan` agent: `edit` denied except `.ai/**` (also `**/.ai/**` fallback). Sets `explore` subagent model to claude-haiku-5.5.      |
| `.opencode/agent/reviewer.md`               | Read-only adversarial reviewer subagent (deepseek-v4.1-flash): bash allowlist for `git diff/log/show/status` + `gh pr diff/view`, `edit: deny`; severity-tagged findings with `file:line`. |
| `.opencode/command/refine.md`               | `/refine` (sonnet-5.5): draft → refined GitHub issue text (may split); prints suggested `gh` commands; no `.ai/` files.                                            |
| `.opencode/command/plan.md`                 | `/plan` (deepseek): branch prep (`switch` or `switch -c <issue>-<slug>`), explore via subagent, writes `.ai/<issue>-<slug>/plan.md` with files/signatures/steps/tests/verification/risks. |
| `.opencode/command/implement.md`            | `/implement` (haiku): branch check (stop if wrong), implements plan exactly, version bump, runs `check → lint → format → test`, writes `diff-report.md`, commits/pushes, proposes `gh pr create` after human confirmation. |
| `.opencode/command/review.md`               | `/review` (deepseek): delegates to `reviewer` subagent, writes report verbatim to `review.md`, fixes nothing.                                                       |
| `.ai/README.md`                             | Handoff-file conventions: per-issue layout, branch naming (created by `/plan`, verified by `/implement`), human gates, refined issues live on GitHub.               |
| `.ai/63-update-opencode-setup-for-the-project/plan.md` | This issue's approved plan (dogfooding the new workflow).                                                                                                |

## Changed files

| File                             | Change                                                                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.github/copilot-instructions.md`| Deleted (115 lines). Unique rules merged into `AGENTS.md`; stale `GLOSSARY.md` pointer removed.                                                              |
| `AGENT_CONTEXT.md`               | Non-goals: replaced "Revised by DESIGN.md §9" note with a clean statement. Features list refreshed: GPT-2/BERT tokenizers; five strategies (+ debug identity); prose/chips/graph; hover inspector + neighbour graph; diagnostics/token-drop/side-by-side marked future. |
| `CONVENTIONS.md`                 | Intro points to `AGENTS.md` as the agent entry point. Dependency pins replaced placeholder: transformers ^3.8.1, seedrandom ^3.0.5, katex ^0.18.7. Test commands added. |
| `DESIGN.md`                      | Title note points agents to `AGENTS.md`/`.ai/README.md` and §10. §9 action item marked Done.                                                                |
| `README.md`                      | Added "Agent workflow" section pointing to `AGENTS.md` and `.ai/README.md`.                                                                                  |
| `src/lib/strategies/README.md`   | Strategy table updated from 3 stale rows to all 5 (`absorbing`, `char-overlap`, `identity`, `lexical`, `uniform`) with correct `stationary` values; note on `neighbor-softmax.ts` + registry as source of truth. |
| `package.json`                   | Version `1.1.0` → `1.2.0` (feat).                                                                                                                            |

## Verification results

| Check                              | Result                                                    |
| ---------------------------------- | --------------------------------------------------------- |
| `npm run check`                    | 0 errors, 0 warnings                                      |
| `npm run lint`                     | passed                                                    |
| `npm run format`                   | applied (only `src/lib/strategies/README.md` needed it)   |
| `npm run test`                     | 26 files / 334 tests passed                               |
| `npx prettier --check .`           | all files formatted                                       |
| `opencode.json` JSON parse         | valid                                                     |
| `grep GLOSSARY\|copilot-instructions` | no live references (only this plan/diff report)        |
| `npm run build`                    | built + wrote static site (extra CI-parity check)         |

## Notes

- `.gitignore` unchanged; `.ai/` is committed intentionally.
- Restart opencode to load `opencode.json`, the new agent, and commands.
- Not yet committed/pushed; PR not created (awaiting human go-ahead).
