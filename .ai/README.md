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
  plan.md          # /plan — concrete implementation plan (human-confirmed)
  diff-report.md   # /implement — what changed and why, per PR
  review.md        # /review — adversarial review findings
```

- `<issue-number>-<slug>` matches the git branch name
  (`63-update-opencode-setup-for-the-project`).
- `/plan` creates or checks out the issue branch as part of its prep;
  `/implement` verifies the current branch before touching code.
- Refined issues live on GitHub, not here.
- `/plan` and `/review` run on opencode's read-only `plan` agent; their
  artifacts are written by the `plan-writer` and `reviewer` subagents.
- `/implement` commits and opens the PR itself; humans confirm the plan →
  implement and review → merge handoffs.
- Never put scratch context dumps or agent logs here.
