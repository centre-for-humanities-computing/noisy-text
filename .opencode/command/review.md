---
description: Adversarial review of the latest round, posted as a marked PR comment
agent: plan
model: openrouter/deepseek/deepseek-v4.1-flash
---

Issue/PR: $ARGUMENTS. Work only from
`.ai/<issue-number>-<slug>/round-N/{plan.md,diff-report.md}` where N is the
latest round. Reviews are delivered as PR comments, not files: the report's
first line is the marker `<!-- noisy-text-review: round=N -->`, and
`round-N/review.md` is a gitignored staging file (the comment's `--body-file`)
that no command reads back.

1. Determine `<issue-number>-<slug>` from the current branch
   (`git rev-parse --abbrev-ref HEAD`) and confirm the folder
   `.ai/<issue-number>-<slug>/` exists. If the artifact directory does not
   match the branch-derived name (deliberate stacking deviation), locate it
   manually and use it; do not create a new one. Derive the round (commands
   never take a round argument):

   ```bash
   ISSUE_DIR=".ai/<issue-number>-<slug>"
   LATEST=$(ls -d "$ISSUE_DIR"/round-*/ 2>/dev/null | sort -V | tail -1)
   ```

   No output → STOP: there are no rounds; run `/plan` first. STOP if
   `round-N/diff-report.md` is missing ("round N is planned but not
   implemented; run `/implement`").

2. Find the open PR for the branch and check for an existing review comment:

   ```bash
   PR=$(gh pr list --head <branch> --state open --json number --jq '.[0].number')
   gh pr view "$PR" --json comments --jq "[.comments[].body | select(startswith(\"<!-- noisy-text-review: round=$N -->\"))] | last"
   ```

   No open PR → STOP ("round N is implemented but not on a PR; run
   `/implement`"). Non-empty output → STOP ("round N already reviewed; run
   `/plan` for a revision round — pass `next` if the verdict was
   `approve with nits` — or merge").

3. Prior findings: for N > 1 fetch the previous round's review comment from
   the PR (same `gh pr view` read with `round=$((N-1))`) and pass it plus its
   `- Open findings:` list to the reviewer; if it is missing, STOP ("round
   N-1 has no review comment on the PR"). For N == 1, pass "none".
4. Reviewed commit: `git rev-parse --short HEAD`. Delta diff for N > 1:
   `git diff <previous review's Reviewed commit>..HEAD`. Cumulative diff:
   `gh pr diff <pr>`.
5. Delegate the review to the `reviewer` subagent (Task tool,
   subagent_type `reviewer`). Give it the issue number, the PR number, the
   branch, the round number N, artifact paths (`round-N/plan.md`,
   `round-N/diff-report.md`, the prior review text when N > 1), the staging
   path `round-N/review.md`, the reviewed commit, and the diff commands; it
   reads everything itself. The reviewer follows the artifact style in
   `.ai/README.md`, writes the report to the staging path, and posts it as
   the marked PR comment — this agent runs under plan mode and must not edit
   any other file.
6. Wait for its report. Do not soften, rewrite, or re-format it. Verify the
   staging file with Read, and verify the comment landed by re-fetching it
   (the round-N marker read above); if the write or the comment post failed,
   report that instead of writing or posting anything yourself.
7. Do not fix anything. End with a handoff summary: comment URL (from the
   `gh pr comment` output the reviewer reports back), staging
   path, round number, verdict, `Open findings`, blockers. A non-approve
   verdict (`block` or `fix-and-recheck`) → run `/plan` for the next round
   in a fresh session. `approve with nits` → the human decides merge or an
   explicit new round (`/plan <issue> next`).
