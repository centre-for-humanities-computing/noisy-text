---
description: Implement a confirmed round plan, open PR, write diff report
agent: build
model: openrouter/z-ai/glm-5.3-flash
---

Issue: $ARGUMENTS (number). Work only from
`.ai/<issue-number>-<slug>/round-N/plan.md` where N is the latest round.

1. Branch check: `git rev-parse --abbrev-ref HEAD` must be
   `<issue-number>-<slug>`. If not, STOP and ask — do not implement on the
   wrong branch.
2. Derive the round (same snippet as `/plan`; commands never take a round
   argument):

   ```bash
   ISSUE_DIR=".ai/<issue-number>-<slug>"
   LATEST=$(ls -d "$ISSUE_DIR"/round-*/ 2>/dev/null | sort -V | tail -1)
   ```

   No output → STOP: there is no round-1 plan yet; run `/plan`.

3. Read `round-N/plan.md` and `CONVENTIONS.md`. STOP if `round-N/plan.md` is
   missing. STOP if `round-N/diff-report.md` exists ("round N already
   implemented; run `/review`"). If the plan is incomplete or contradicts the
   code, STOP and ask — do not guess.
4. Implement exactly the plan. No scope creep.
5. Version: bump `package.json` per SemVer (`CONVENTIONS.md` §Versioning:
   breaking → major, `feat` → minor, otherwise patch) only when `N == 1`;
   revision rounds leave the version untouched (one bump per issue).
6. Run the verification sequence in order: `npm run check`, `npm run lint`,
   `npm run format`, `npm run test`. Fix only what you broke.
7. Write `.ai/<issue-number>-<slug>/round-N/diff-report.md`: per changed file,
   what changed, why, and how it maps to the plan; plus verification results.
   Follow the artifact style in `.ai/README.md` (headings and bullets, no
   tables); write for a human reader, not a diff dump. Begin the report with
   the header:

   ```
   - Round: <N>
   - Commits: <type>(#<n>): <summary> (round <N>)
   ```

   `Commits` records the subject of the round's single commit (the report is
   committed with that commit, so the sha is not known beforehand;
   `git log -1 --format=%h` gives it afterward).

8. One commit per round: stage all changes including the diff report and run
   `git commit -m "<type>(#<n>): <summary> (round <N>)"`. Round 1 uses the
   issue's type (`feat`); revision rounds use `fix`.
9. Push, then reuse the PR if one exists:

   ```bash
   gh pr list --head <issue-number>-<slug> --state open --json number,url
   ```

   Non-empty → `git push` and report the existing URL. Empty →
   `git push -u origin <issue-number>-<slug>` then
   `gh pr create --base main --head <issue-number>-<slug> --title "<type>(#<issue-number>): <summary>" --body "<change summary, `Closes #<issue-number>`, verification results>"`.
   Never merge.

End with a handoff summary: round number, PR URL, what to check, what comes
next (`/review`).
