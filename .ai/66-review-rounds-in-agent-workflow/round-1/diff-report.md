# Diff report: Issue #66 — Support review rounds in the plan → implement → review loop

- Round: 1
- Commits: `feat(#66): support review rounds in plan → implement → review` (round 1)

## Branch deviation (human-approved)

- The plan stacked `66-review-rounds-in-agent-workflow` on
  `63-update-opencode-setup-for-the-project` with a separate PR. The human
  changed this: no separate branch or PR; #66 lands on the 63 branch and both
  issues merge in one PR. `/implement`'s branch check was skipped per the
  human's instruction. All other plan steps were followed exactly.

## Per-file changes

- `.ai/README.md` — layout block now
  `.ai/<issue-number>-<slug>/round-N/{plan.md,diff-report.md,review.md}`
  (example branch `66-review-rounds-in-agent-workflow`); added a `## Rounds`
  section with round derivation (numeric max of `round-*/`, none → round 1),
  loop policy (`block`/`fix-and-recheck` → new `/plan`; `approve with nits`
  ends the loop; no round cap), one commit per round, once-per-issue version
  bump, artifact header lists, and the `/refine` escape hatch. Plan §`.ai/
  README.md`.
- `.opencode/agent/reviewer.md` — new header block (`Round`, `Reviewed
  commit`, `Verdict`, `Open findings`), `## Previous findings status` section
  (one bullet per prior finding: `fixed` / `still open` / `superseded` with
  evidence), verdict semantics (`approve with nits` only when nothing
  required remains), and expanded inputs (round N, artifact paths, prior
  review, delta + cumulative diff commands). Plan §`.opencode/agent/
  reviewer.md`.
- `.opencode/command/plan.md` — round derivation snippet
  (`ls -d round-* | sort -V | tail -1`); stop states for unreviewed and
  approved-with-nits rounds; revision plans at `round-(N+1)/plan.md` scoped
  to the review's `Open findings` IDs with a `## Findings and actions`
  section; `Round`/`Addresses` headers. Plan §`.opencode/command/plan.md`.
- `.opencode/command/implement.md` — reads `round-N/plan.md`; stop when
  `round-N/diff-report.md` exists; version bump only on round 1 (once per
  issue); diff report under `round-N/` with `Round`/`Commits` header
  (subject, not sha); one commit per round (`feat` round 1, `fix` after);
  PR reuse via `gh pr list --head <branch>` instead of always creating.
  Plan §`.opencode/command/implement.md`.
- `.opencode/command/review.md` — requires `round-N/diff-report.md`, stops
  when `round-N/review.md` exists; reads prior round's review for N > 1 and
  passes its `Open findings`; reviewed commit `git rev-parse --short HEAD`;
  delta diff from the previous reviewed commit for N > 1, cumulative
  `gh pr diff` or `git diff origin/main...HEAD`; handoff replaces the
  "send blockers back to `/implement`" line with the verdict-driven loop.
  Plan §`.opencode/command/review.md`.
- `.opencode/command/refine.md` — added the escape-hatch line: when a review
  shows the issue scope itself is wrong, `/refine` rewrites the GitHub issue
  and a fresh `/plan` starts over. Plan §`.opencode/command/refine.md`.
- `AGENTS.md` — workflow paragraph now describes `round-N/` artifacts, the
  no-cap loop, one commit per round, once-per-issue bump, fresh session per
  round, and `/refine` as the scope escape hatch. Plan §`AGENTS.md`.
- `CONVENTIONS.md` — `## Versioning` clarified: bump lands in the round-1
  commit; later review-round commits do not bump again. Plan §`CONVENTIONS.md
  (§Versioning)`.
- `package.json` — `1.2.0` → `1.3.0` (feat → minor, round 1 only). Plan
  §`package.json`.

## Not changed (per plan)

- No migration of #63's flat artifacts into `round-1/` (optional follow-up,
  out of scope).
- No changes to the read-only `plan`/`review` agent definitions, no new
  dependencies, no CI changes, no code changes (tests: none added).

## Verification

1. `npm run check` — 0 errors, 0 warnings.
2. `npm run lint` — eslint clean.
3. `npm run format` — Prettier rewrote three command files (plan/review/
   implement); `npx prettier --check .` then clean.
4. `npm run test` — 334/334 passed.
5. Agent configs unchanged this issue (models were set by #63), so
   `opencode debug agent` checks were not repeated; the human should restart
   opencode so the edited commands/agents load.
