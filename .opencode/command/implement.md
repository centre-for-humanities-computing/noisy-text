---
description: Implement a confirmed plan, open PR, write diff report
agent: build
model: openrouter/anthropic/claude-haiku-5.5
---

Issue: $ARGUMENTS (number). Work only from `.ai/<issue-number>-<slug>/plan.md`.

1. Branch check: `git rev-parse --abbrev-ref HEAD` must be
   `<issue-number>-<slug>`. If not, STOP and ask — do not implement on the
   wrong branch.
2. Read `plan.md` and `CONVENTIONS.md`. If the plan is missing, incomplete, or
   contradicts the code, STOP and ask — do not guess.
3. Implement exactly the plan. No scope creep.
4. Bump `package.json` version (feat → minor, fix → patch).
5. Run the verification sequence in order: `npm run check`, `npm run lint`,
   `npm run format`, `npm run test`. Fix only what you broke.
6. Write `.ai/<issue-number>-<slug>/diff-report.md`: per changed file, what
   changed, why, and how it maps to the plan; plus verification results. Written
   for a human reader, not a diff dump.
7. Commit with conventional messages referencing the issue (`feat(#12): ...`).
   Push branch `<issue-number>-<slug>`.
8. Show the exact `gh pr create` command and WAIT for human confirmation; then
   run it and report the PR URL.

End with a handoff summary: PR URL, what to check, what comes next (`/review`).
