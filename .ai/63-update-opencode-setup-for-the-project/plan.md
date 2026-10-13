# Plan: Issue #63 — Update opencode setup for the project

Status: approved by human (two nitpicks folded in: verification order is
`check → lint → format → test`; `/plan` creates/checks out the issue branch as
part of prep, `/implement` verifies it).

## Locked decisions

| Topic                | Decision                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.ai/` in git        | Commit `plan.md`, `diff-report.md`, `review.md`. Refined issues live on GitHub only                                                                 |
| Docs                 | Compact `AGENTS.md` entry point; keep `CONVENTIONS.md`, `AGENT_CONTEXT.md`, `DESIGN.md` as on-demand refs; delete `.github/copilot-instructions.md` |
| Workflow in opencode | 4 slash commands (`/refine`, `/plan`, `/implement`, `/review`) + read-only `reviewer` subagent                                                      |
| Plan write access    | Override built-in `plan` agent: `edit` allowed only under `.ai/**`                                                                                  |
| PR creation          | `/implement` suggests `gh pr create`, waits for human confirm, then runs it                                                                         |
| Models               | `/refine` sonnet-5.5 · `/plan` deepseek-v4.1-flash · `/implement` haiku-5.5 · `/review` deepseek-v4.1-flash · `explore` subagent haiku-5.5          |
| `.ai/` layout        | `.ai/<issue-number>-<slug>/{plan.md,diff-report.md,review.md}`                                                                                      |

## Goal and acceptance criteria

- Tasks hand off through files in `.ai/` (plans, diff reports, reviews).
- The markdown config files are cleaned up; `AGENTS.md` is a compact, meaningful
  entry point that delegates exploration to subagents to save tokens.
- The workflow `refine → plan → implement → review → merge` lives in opencode as
  commands + a reviewer subagent, with human confirmation at each handoff.
- Refined issues live on GitHub, not in `.ai/`.

## Files to create

### `opencode.json`

```json
{
	"$schema": "https://opencode.ai/config.json",
	"agent": {
		"plan": {
			"permission": {
				"edit": { "*": "deny", ".ai/**": "allow", "**/.ai/**": "allow" }
			}
		},
		"explore": {
			"model": "openrouter/anthropic/claude-haiku-5.5"
		}
	}
}
```

`CONVENTIONS.md` is deliberately not in `instructions` — always-loaded context
costs tokens; `AGENTS.md` references it instead. `small_model` left unset.

### `.opencode/agent/reviewer.md`

Read-only adversarial reviewer subagent, model
`openrouter/deepseek/deepseek-v4.1-flash`, `edit: deny`, bash allowlist for
`git diff/log/show/status` and `gh pr diff/view`, else ask. Reviews math
correctness, plan conformance, conventions, tests, worker boundaries. Output:
verdict + severity-tagged findings with `file:line` + required fixes.

### `.opencode/command/refine.md`

`agent: plan`, `model: openrouter/anthropic/claude-sonnet-5.5`. Input: draft or
issue number. Explores via `explore` subagent, reads relevant doc sections,
outputs refined issue text in chat (splitting oversized issues), ends with
suggested `gh issue create/edit` commands for the human. Produces Git issues —
no `.ai/` files.

### `.opencode/command/plan.md`

`agent: plan`, `model: openrouter/deepseek/deepseek-v4.1-flash`.

Branch prep (new): verify `git rev-parse --abbrev-ref HEAD` is
`<issue-number>-<slug>`; if not, `git switch <branch>` when it exists, else
`git switch -c <issue-number>-<slug>`.

Then: explore via subagent with `file:line` evidence; read `CONVENTIONS.md` and
relevant per-directory READMEs; write
`.ai/<issue-number>-<slug>/plan.md` with goal/acceptance criteria, exact
files + exported signatures/types, ordered steps, tests + verification order
(`npm run check` → `npm run lint` → `npm run format` → `npm run test`), edge
cases/risks/out-of-scope, open questions. No edits outside `.ai/`. End with
handoff asking the human to confirm before `/implement`.

### `.opencode/command/implement.md`

`agent: build`, `model: openrouter/anthropic/claude-haiku-5.5`.

Branch check (new): current branch must be `<issue-number>-<slug>`; otherwise
stop and ask. Read `plan.md` + `CONVENTIONS.md`; stop if the plan is
missing/ambiguous. Implement exactly the plan; no scope creep. Bump
`package.json` version (feat → minor, fix → patch). Run verification in order:
`npm run check`, `npm run lint`, `npm run format`, `npm run test`. Write
`.ai/<issue-number>-<slug>/diff-report.md` (per-file what/why/plan mapping +
verification results). Commit `feat(#n): ...`, push branch. Show exact
`gh pr create`, wait for human confirmation, then run it and report the URL.

### `.opencode/command/review.md`

`agent: build`, `model: openrouter/deepseek/deepseek-v4.1-flash`. Delegates to
the `reviewer` subagent (Task tool, subagent_type `reviewer`) with issue
number, branch, and artifact paths; writes the report verbatim to
`.ai/<issue-number>-<slug>/review.md`; fixes nothing; ends with verdict +
blockers for the human.

### `.ai/README.md`

Documents the per-issue layout, branch naming (branch created by `/plan`,
verified by `/implement`), human confirmation gates, commit policy, and the
rule that refined issues live on GitHub.

### `AGENTS.md` (root, always loaded)

Sections: one-paragraph project summary; "read only what you need" table
mapping needs → docs; commands (including single-test invocations, CI jobs, and
per-issue verification order `check → lint → format → test`); non-negotiables
(coupled sampling, RNG draw order, typed arrays, pure registry-driven
strategies/schedules, workers >50 ms, no new deps, `$...$` math, strict TS,
tests beside code, conventional commits + version bump); workflow and handoffs
(commands, `.ai/` files, branch created by `/plan`); context discipline
(explore subagent first, grep before read, no re-reads, compress finished work).

## Changes to existing files

1. Delete `.github/copilot-instructions.md` (unique rules now in `AGENTS.md`;
   stale `GLOSSARY.md` pointer disappears — grep confirms it exists nowhere
   else).
2. `AGENT_CONTEXT.md`:
   - Non-goals: replace the "Revised by DESIGN.md §9" note with a clean
     statement that visual/UX quality is first-class per `DESIGN.md`, but
     functionality and clarity still come first.
   - "Features the user cares about": replace the stale list with current
     reality (GPT-2/BERT tokenizers; uniform/absorbing/lexical/char-overlap +
     debug-only identity; linear/cosine/constant schedules; prose/chips/full
     graph; hover inspector + neighbour graph) and mark diagnostics,
     token-dropping, side-by-side comparison as future work.
3. `CONVENTIONS.md`:
   - Intro: note `AGENTS.md` is the entry point for agents.
   - Dependencies: replace the `@huggingface/transformers` placeholder with
     `^3.8.1` + pointer to `docs/libraries.md`; add `seedrandom ^3.0.5` and
     `katex ^0.18.7`.
   - Tests: add `npm run test` and single-file invocation.
4. `DESIGN.md`: replace §9 action item with "Done: ..."; add a two-line note
   under the title pointing to `AGENTS.md`/`.ai/README.md` and flagging §10 for
   implementation.
5. `src/lib/strategies/README.md`: update the stale table to all five
   strategies with correct `stationary` values; note shared
   `neighbor-softmax.ts` and that `registry.ts` is the source of truth.
6. `README.md`: add an "Agent workflow" section pointing to `AGENTS.md` and
   `.ai/README.md`.
7. `package.json`: version `1.1.0` → `1.2.0` (feat).

`.gitignore`: no change — `.ai/` is committed.

## Verification

1. `npm run check`
2. `npm run lint`
3. `npm run format`
4. `npm run test`
5. `npx prettier --check .`
6. JSON syntax: `node --input-type=module -e "import fs from 'node:fs'; JSON.parse(fs.readFileSync('opencode.json','utf8')); console.log('ok')"`
7. `grep -rn "GLOSSARY\|copilot-instructions"` → no matches
8. Remind the user to restart opencode (config/agents/commands load at startup)

## Risks and fallbacks

- `edit` permission patterns: if `.ai/**` does not match (absolute vs relative
  paths), the config also includes `**/.ai/**`. If per-pattern edit permissions
  are unsupported, fall back to a custom `planner` primary agent or run `/plan`
  on `build` with a template-enforced restriction.
- Overriding the built-in `plan` agent changes plan-mode write access
  project-wide (`.ai/` only) — intended.
- Custom `/plan` and `/review` command names: low collision risk with built-ins.

## Out of scope

GitHub issue creation via Claude.ai, PR merge, branch-protection policy.
Commands only print suggested `gh` commands or run them after explicit human
confirmation.
