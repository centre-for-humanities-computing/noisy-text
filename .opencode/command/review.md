---
description: Adversarial review of the latest round, written to .ai/<issue>-<slug>/round-N/review.md
agent: plan
model: openrouter/deepseek/deepseek-v4.1-flash
---

Issue/PR: $ARGUMENTS. Work only from
`.ai/<issue-number>-<slug>/round-N/{plan.md,diff-report.md}` where N is the
latest round.

1. Determine `<issue-number>-<slug>` from the current branch
   (`git rev-parse --abbrev-ref HEAD`) and confirm the folder
   `.ai/<issue-number>-<slug>/` exists. Derive the round (commands never take
   a round argument):

   ```bash
   ISSUE_DIR=".ai/<issue-number>-<slug>"
   LATEST=$(ls -d "$ISSUE_DIR"/round-*/ 2>/dev/null | sort -V | tail -1)
   ```

   No output → STOP: there are no rounds; run `/plan` first. STOP if
   `round-N/diff-report.md` is missing ("round N not implemented"). STOP if
   `round-N/review.md` exists ("round N already reviewed; run `/plan` for a
   revision or merge").

2. Prior findings: for N > 1 read `round-(N-1)/review.md` and pass it plus its
   `- Open findings:` list to the reviewer. For N == 1, pass "none".
3. Reviewed commit: `git rev-parse --short HEAD`. Delta diff for N > 1:
   `git diff <previous review's Reviewed commit>..HEAD`. Cumulative diff:
   `gh pr diff <pr>` if a PR exists, else `git diff origin/main...HEAD`
   (local `main` can be stale).
4. Delegate the review to the `reviewer` subagent (Task tool,
   subagent_type `reviewer`). Give it the issue number, branch, the round
   number N, artifact paths (`round-N/plan.md`, `round-N/diff-report.md`, the
   prior review when N > 1), the report path `round-N/review.md`, the
   reviewed commit, and the diff commands; it reads everything itself. The
   reviewer follows the artifact style in `.ai/README.md` and writes its
   report to the report path itself — this agent runs under plan mode and
   must not edit files.
5. Wait for its report. Do not soften, rewrite, or re-format it. Verify with
   Read that `round-N/review.md` exists and holds the full report from the
   reviewer; if the write failed, report that instead of writing anything
   yourself.
6. Do not fix anything. End with a handoff summary: written report path,
   round number, verdict, `Open findings`, blockers. A non-approve verdict
   (`block` or `fix-and-recheck`) → run `/plan` for the next round in a
   fresh session. `approve with nits` → the human decides merge or an
   explicit new round.
