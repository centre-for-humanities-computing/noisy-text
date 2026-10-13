# `.ai/` — handoff artifacts

Files here are the handoffs between agent workflow phases (see `AGENTS.md`).
Every task starts in a fresh session and works from these files. Keep them
human-readable and committed.

## Artifact style

These files are read rendered, raw, and in diffs. Write for all three:

- Wrap prose at ~80 columns; one idea per paragraph.
- Structure with `##`/`###` headings and bullets; use a short bold lead-in on
  each bullet when it helps scanning.
- No tables. Findings, file lists, and verification results are bullet lists;
  reserve a table for genuinely tabular data with short cells only.
- Keep lists flat (one nesting level).
- Reference code as `path:line`.

## Layout

```
.ai/<issue-number>-<slug>/
  round-N/
    plan.md          # /plan — concrete implementation plan (human-confirmed)
    diff-report.md   # /implement — what changed and why, per round
    review.md        # /review — gitignored staging file; see below
```

- `<issue-number>-<slug>` matches the git branch name
  (`66-review-rounds-in-agent-workflow`). This derivation is an invariant:
  when a task's work deliberately lands on a different issue's branch
  (stacking deviation), locate the artifact directory manually instead of
  deriving it from the branch, and never create a new directory for it.
- Flat artifacts directly under `<issue-number>-<slug>/` (issue #63 layout)
  are legacy; they stay as-is and are not migrated.

## Review transport

- The review report is a PR comment whose first line is the marker
  `<!-- noisy-text-review: round=N -->`. Commands fetch reviews from the open
  PR for the branch and match them by marker.
- `round-N/review.md` is only the staging file the reviewer writes and posts
  with `gh pr comment --body-file`; it is gitignored and never read back by
  any command.

## Rounds

- One `round-N/` directory per plan → implement → review pass. Round 1 is the
  initial plan; round N+1 is a revision plan scoped to round N's open findings.
- Commands derive the latest round from `round-*/` (numeric max) with no extra
  arguments; they never take a round argument. One exception: the explicit
  override `/plan <issue> next` forces round N+1 after an `approve with nits`
  verdict.
- Loop policy: a `block` or `fix-and-recheck` verdict loops to a new `/plan`
  (revision round). `approve with nits` ends the loop — the human decides
  merge or explicitly requests another round via `/plan <issue> next`. There
  is no round cap.
- Reviews are read from the PR by marker, not from `review.md` files; the
  `- Verdict:` bullet of the comment is the verdict contract.
- Commands surface the round number and repeated findings; each round runs in
  a fresh session.
- `/refine` is the escape hatch when a review shows the issue scope itself is
  wrong — refine the GitHub issue, then start a fresh `/plan`.
- One commit per round, on the same branch and PR; `package.json` is bumped
  once per issue (round 1 only).
- Required artifact headers: plan has `Round` + `Addresses`; diff report has
  `Round` + `Commits`; review has `Round` + `Reviewed commit` + `Verdict` +
  `Open findings`.

## Layout rules

- `/plan` creates or checks out the issue branch as part of its prep in round
  1 and only verifies the branch in later rounds; `/implement` verifies the
  current branch before touching code.
- Refined issues live on GitHub, not here.
- `/plan` and `/review` run on opencode's read-only `plan` agent; their
  artifacts are written by the `plan-writer` and `reviewer` subagents. The
  `reviewer` also posts the marked review comment (its one PR write).
- `/implement` commits and opens the PR itself; humans confirm the plan →
  implement and review → merge handoffs.
- Never put scratch context dumps or agent logs here.
