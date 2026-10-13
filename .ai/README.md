# `.ai/` — handoff artifacts

Files here are the handoffs between agent workflow phases (see `AGENTS.md`).
Every task starts in a fresh session and works from these files. Keep them
human-readable and committed.

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
- Humans confirm every handoff: plan → implement, PR → review, review → merge.
- Never put scratch context dumps or agent logs here.
