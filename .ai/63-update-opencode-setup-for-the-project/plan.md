# Plan: Issue #63 — Update opencode setup for the project

Status: approved by human; amended during the review follow-up (see "Review
follow-up" at the end). Two nitpicks folded in at approval: verification order
is `check → lint → format → test`; `/plan` creates/checks out the issue branch
as part of prep, `/implement` verifies it.

## Locked decisions

- **`.ai/` in git.** Commit `plan.md`, `diff-report.md`, `review.md`. Refined
  issues live on GitHub only.
- **Docs.** Compact `AGENTS.md` entry point; keep `CONVENTIONS.md`,
  `AGENT_CONTEXT.md`, `DESIGN.md` as on-demand refs; delete
  `.github/copilot-instructions.md`.
- **Workflow in opencode.** Four slash commands (`/refine`, `/plan`,
  `/implement`, `/review`) plus the `reviewer` and `plan-writer` subagents.
- **Plan-mode writes.** The built-in `plan` agent is the primary agent for
  `/plan` and `/review`, and is read-only in practice: opencode's plan-mode
  reminder forbids all edits with no exception. Artifacts are written by
  subagents — `plan-writer` for `plan.md`, `reviewer` for `review.md`.
- **PR creation.** `/implement` commits, pushes, and opens the PR itself
  (`gh pr create`); it never merges.
- **Versioning.** `package.json` follows the SemVer table in
  `CONVENTIONS.md §Versioning` (breaking → major, `feat` → minor, otherwise
  patch).
- **Artifact style.** `.ai/` is Prettier-ignored; artifacts follow the style
  in `.ai/README.md` (headings and bullets, no tables, ~80 columns).
- **Models.** `/refine` sonnet-5.5 · `/plan` deepseek-v4.1-flash ·
  `/implement` haiku-5.5 · `/review` deepseek-v4.1-flash · `explore` and
  `plan-writer` haiku-5.5.
- **`.ai/` layout.**
  `.ai/<issue-number>-<slug>/{plan.md,diff-report.md,review.md}`.

## Goal and acceptance criteria

- Tasks hand off through files in `.ai/` (plans, diff reports, reviews).
- The markdown config files are cleaned up; `AGENTS.md` is a compact,
  meaningful entry point that delegates exploration to subagents to save
  tokens.
- The workflow `refine → plan → implement → review → merge` lives in opencode
  as commands + subagents, with human confirmation at the plan gate and the
  merge decision.
- Refined issues live on GitHub, not in `.ai/`.
- Handoff artifacts are equally readable rendered and raw (headings and
  bullets; no tables).

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
`openrouter/deepseek/deepseek-v4.1-flash`. Bash allowlist for read-only
`git`/`gh`/`npm`/`npx` commands (denies `npm run format`, `git commit`,
`git push`); edit allowed only under `.ai/**`. Reviews math correctness, plan
conformance, conventions, tests, worker boundaries. Writes `review.md` itself
(its only permitted write). Output per `.ai/README.md`: verdict, `### B<n>`
blockers, `### N<n>` non-blocking concerns, gaps, open questions — no tables.

### `.opencode/agent/plan-writer.md`

Transcription-only subagent (haiku-5.5) used by `/plan`: receives the
finalized plan markdown plus an `.ai/` target path and writes it verbatim.
Edit allowed only under `.ai/**`; bash denied.

### `.opencode/command/refine.md`

`agent: plan`, `model: openrouter/anthropic/claude-sonnet-5.5`. Input: draft
or issue number. Explores via `explore` subagent, reads relevant doc sections,
outputs refined issue text in chat (splitting oversized issues), ends with
suggested `gh issue create/edit` commands for the human. Produces Git issues —
no `.ai/` files.

### `.opencode/command/plan.md`

`agent: plan`, `model: openrouter/deepseek/deepseek-v4.1-flash`.

Branch prep: verify `git rev-parse --abbrev-ref HEAD` is
`<issue-number>-<slug>`; if not, `git switch <branch>` when it exists, else
`git switch -c <issue-number>-<slug>`.

Then: explore via subagent with `file:line` evidence; read `CONVENTIONS.md` and
relevant per-directory READMEs; compose the plan (goal/acceptance criteria,
exact files + exported signatures/types, ordered steps, tests + verification
order `check → lint → format → test`, edge cases/risks/out-of-scope, open
questions) following the `.ai/README.md` style. The main agent cannot edit
files under plan mode, so it passes the exact markdown to the `plan-writer`
subagent, then reads the file back to verify. Ends with a handoff asking the
human to confirm before `/implement`.

### `.opencode/command/implement.md`

`agent: build`, `model: openrouter/anthropic/claude-haiku-5.5`.

Branch check: current branch must be `<issue-number>-<slug>`; otherwise stop
and ask. Read `plan.md` + `CONVENTIONS.md`; stop if the plan is
missing/ambiguous. Implement exactly the plan; no scope creep. Bump
`package.json` per the SemVer table. Run verification in order:
`npm run check`, `npm run lint`, `npm run format`, `npm run test`. Write
`.ai/<issue-number>-<slug>/diff-report.md` (per-file what/why/plan mapping +
verification results) in the artifact style. Commit `feat(#n): ...`, push the
branch, run `gh pr create`, and report the URL. Never merge.

### `.opencode/command/review.md`

`agent: plan`, `model: openrouter/deepseek/deepseek-v4.1-flash`. Deliberately
stays on the read-only agent: the main loop fixes nothing and cannot edit; it
delegates to the `reviewer` subagent (Task tool, subagent_type `reviewer`)
with issue number, branch, artifact paths, and report path; the reviewer
writes the report to `.ai/<issue-number>-<slug>/review.md` itself. Ends with
verdict + blockers for the human.

### `.ai/README.md`

Documents the per-issue layout, branch naming (branch created by `/plan`,
verified by `/implement`), human confirmation gates, commit policy, the rule
that refined issues live on GitHub, the subagent write model, and the artifact
style (readable rendered and raw: headings and bullets, no tables).

### `AGENTS.md` (root, always loaded)

Sections: one-paragraph project summary; "read only what you need" table
mapping needs → docs; commands (including single-test invocations, CI jobs,
and per-issue verification order `check → lint → format → test`);
non-negotiables (coupled sampling, RNG draw order, typed arrays, pure
registry-driven strategies/schedules, workers >50 ms, no new deps, `$...$`
math, strict TS, tests beside code, conventional commits + SemVer bump);
workflow and handoffs (commands, `.ai/` files, read-only plan/review agents
with subagent writers); context discipline (explore subagent first, grep
before read, no re-reads, compress finished work).

## Changes to existing files

1. Delete `.github/copilot-instructions.md` (unique rules now in `AGENTS.md`;
   stale `GLOSSARY.md` pointer disappears — grep confirms it exists nowhere
   else).
2. `AGENT_CONTEXT.md`: non-goals note replaced with a clean statement that
   visual/UX quality is first-class per `DESIGN.md`, but functionality and
   clarity come first; "features the user cares about" refreshed to current
   reality (GPT-2/BERT tokenizers; uniform/absorbing/lexical/char-overlap +
   debug-only identity; linear/cosine/constant schedules; prose/chips/full
   graph; hover inspector + neighbour graph), with diagnostics,
   token-dropping, and side-by-side comparison marked future work.
3. `CONVENTIONS.md`: intro points to `AGENTS.md` as the agent entry point;
   dependency pins updated (`@huggingface/transformers ^3.8.1`, `seedrandom
   ^3.0.5`, `katex ^0.18.7`) with a `docs/libraries.md` pointer; test commands
   added; strategy registration path corrected to `registry.ts`; `console`
   rule added under TypeScript; `## Versioning` table added.
4. `DESIGN.md`: §9 action item replaced with "Done: ..."; two-line note under
   the title pointing to `AGENTS.md`/`.ai/README.md` and flagging §10 for
   implementation.
5. `src/lib/strategies/README.md`: stale table updated to all five strategies
   with correct `stationary` values; note shared `neighbor-softmax.ts` and
   `registry.ts` as source of truth.
6. `README.md`: "Agent workflow" section pointing to `AGENTS.md` and
   `.ai/README.md`.
7. `package.json`: version `1.1.0` → `1.2.0` (feat), per the approved plan.
8. `.prettierignore`: add `.ai/` (artifacts are prose written after the format
   step; they stay committed and human-readable).

`.gitignore`: no change — `.ai/` is committed.

## Verification

1. `npm run check`
2. `npm run lint`
3. `npm run format`
4. `npm run test`
5. `npx prettier --check .` (does not cover `.ai/`)
6. JSON syntax: `node --input-type=module -e "import fs from 'node:fs';
   JSON.parse(fs.readFileSync('opencode.json','utf8')); console.log('ok')"`
7. `grep -rn "GLOSSARY\|copilot-instructions"` → no matches
8. `opencode debug agent plan-writer reviewer` → edit/bash rules as specified
   (`opencode run` does not enforce permissions, so probes only prove
   capability)
9. Remind the user to restart opencode (config/agents/commands load at
   startup)

## Risks and fallbacks

- The `.ai/**` edit permission resolves as intended, but opencode's plan-mode
  reminder makes the `plan` agent fully read-only in practice (no exception;
  verified empirically). `/plan` and `/review` therefore delegate artifact
  writes to subagents; the `opencode.json` override stays as defence in depth.
- Overriding the built-in `plan` agent changes plan-mode write access
  project-wide — intended.
- Custom `/plan` and `/review` command names: low collision risk with
  built-ins.

## Out of scope

GitHub issue creation via Claude.ai, PR merge, branch-protection policy.
Commands only print suggested `gh` commands or run them after explicit human
confirmation.

## Review follow-up (first `/review` pass)

The first `/review` (commit `56811db`) returned `block` with one CI blocker
and seven notes. Resolution:

- **B1 — artifacts failed `prettier --check`.** `.ai/` added to
  `.prettierignore`; the committed diff report was reformatted.
- **N1 — `/review` agent deviation.** Kept `agent: plan` deliberately (the
  main loop must never fix findings); documented here and in the command.
- **N2 — format-before-artifact ordering.** Moot for `.ai/` once ignored;
  commands still format before writing artifacts.
- **N3 — broken single-test example.** `AGENTS.md` now uses
  `-t "is deterministic for the same seed"`.
- **N4 — unbacked `console` rule.** Rule added to `CONVENTIONS.md`
  (TypeScript section); `AGENTS.md` keeps the summary.
- **N5 — stale registry path.** `CONVENTIONS.md` now points at `registry.ts`.
- **N6 — stale diff-report status.** Fixed in the restructured report.
- **N7 — minor bump on `chore`.** Left as approved; the new Versioning table
  governs from here.
- **Plan-mode writes.** Confirmed the `plan` agent cannot write under plan
  mode; `/plan` now mirrors the `/review` fix with the `plan-writer`
  subagent.
- **Artifact readability.** Plan, diff report, and review restructured to
  headed bullets (no tables); commands/agents updated via the `.ai/README.md`
  style.
