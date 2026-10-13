---
description: Implement a confirmed plan, open PR, write diff report
agent: build
model: openrouter/z-ai/glm-5.3-flash
---

Issue: $ARGUMENTS (number). Work only from `.ai/<issue-number>-<slug>/plan.md`.

1. Branch check: `git rev-parse --abbrev-ref HEAD` must be
   `<issue-number>-<slug>`. If not, STOP and ask — do not implement on the
   wrong branch.
2. Read `plan.md` and `CONVENTIONS.md`. If the plan is missing, incomplete, or
   contradicts the code, STOP and ask — do not guess.
3. Implement exactly the plan. No scope creep.
4. Bump `package.json` per SemVer (`CONVENTIONS.md` §Versioning: breaking →
   major, `feat` → minor, otherwise patch).
5. Run the verification sequence in order: `npm run check`, `npm run lint`,
   `npm run format`, `npm run test`. Fix only what you broke.
6. Write `.ai/<issue-number>-<slug>/diff-report.md`: per changed file, what
   changed, why, and how it maps to the plan; plus verification results.
   Follow the artifact style in `.ai/README.md` (headings and bullets, no
   tables); write for a human reader, not a diff dump.
7. Commit with a conventional message referencing the issue
   (`feat(#12): ...`), including the diff report.
8. Push `<issue-number>-<slug>` and open the PR yourself:
   `gh pr create --base main --head <issue-number>-<slug> --title "<type>(#<issue-number>): <summary>" --body "<change summary, `Closes #<issue-number>`, verification results>"`.
   Do not merge.

End with a handoff summary: PR URL, what to check, what comes next (`/review`).
