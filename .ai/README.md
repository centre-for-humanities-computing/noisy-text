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
    plan.md          # /plan — sliced implementation plan (human-confirmed)
    diff-report.md   # /implement — short round report; git cannot tell the rest
    review.json      # /review — reviewer's structured report; gitignored
    review.md        # generated comment body by scripts/review-pack.mjs; gitignored
    review.html      # generated local reading view; gitignored
    slices/S<k>.json # per-slice reviewer findings (per-slice mode); gitignored
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
- The reviewer writes `round-N/review.json` (the source of truth).
  `scripts/review-pack.mjs` validates it, fills slice sizes and quoted hunks
  from git, and generates `review.md` (the PR comment body) and `review.html`
  (a local, colour-coded reading view). No command reads the generated files
  back.
- `round-N/review.md` is posted with `gh pr comment --body-file`; the generated
  files are gitignored.
- In per-slice mode, `round-N/slices/S<k>.json` holds each `slice-reviewer`
  subagent's findings. The integrating reviewer verifies them before folding
  them into `review.json`; skipped mechanical slices have no JSON file.

## Diff report

- `round-N/diff-report.md` is short: it records only what git cannot. Begin
  with `- Round` and `- Commits: <count> (<first>..<last>)`, then cover
  deviations from the plan, known limitations and residual risk, code paths
  not exercised, and verification results.
- The commit log explains each slice; do not repeat per-file narrative.
- The reviewer checks the report against the actual diff, so it cannot drift
  from the code; the review comment's orientation sections are the human's
  secondary overview.

## Rounds

- One `round-N/` directory per plan → implement → review pass. Round 1 is the
  initial plan; round N+1 is a revision plan scoped to round N's open findings.
- Commands derive the latest round from `round-*/` (numeric max) with no extra
  arguments; they never take a round argument. One exception: the explicit
  override `/plan <issue> next` forces round N+1 after an `approve with nits`
  verdict.
- Loop policy: a `block` or `fix-and-recheck` verdict loops to a new `/plan`
  (revision round). `approve with nits` ends the loop — the human decides
  merge or explicitly requests another round via `/plan <issue> next`; nits
  the human accepts are filed as a follow-up issue rather than re-reviewed.
  There is no round cap.
- Reviews are read from the PR by marker, not from `review.md` files; the
  `- Verdict:` bullet of the comment is the verdict contract.
- Commands surface the round number and repeated findings; each round runs in
  a fresh session.
- `/refine` is the escape hatch when a review shows the issue scope itself is
  wrong — refine the GitHub issue, then start a fresh `/plan`.
- One commit per slice, on the same branch and PR; split over-budget slices
  into `S<k>a`, `S<k>b`, … with one commit each. `package.json` is bumped once
  per issue, in the final mechanical slice of round 1.
- Required artifact headers: plan has `Round` + `Addresses` + `Slices` +
  `Estimated size`; diff report has `Round` + `Commits`; review has `Round` +
  `Reviewed commit` + `Verdict` + `Open findings`.

## Layout rules

- `/plan` creates or checks out the issue branch as part of its prep in round
  1 and only verifies the branch in later rounds; it enforces a round-1 size
  gate of ≤1200 changed lines unless `large` is passed. `/implement` verifies
  the current branch before touching code.
- Refined issues live on GitHub, not here.
- `/plan` and `/review` run on opencode's read-only `plan` agent; their
  artifacts are written by the `plan-writer`, `reviewer`, and `slice-reviewer`
  subagents. The `reviewer` also runs `scripts/review-pack.mjs` and posts the
  marked review comment (its one PR write).
- `/implement` commits and opens the PR itself; humans confirm the plan →
  implement and review → merge handoffs.
- Never put scratch context dumps or agent logs here.
