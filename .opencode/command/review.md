---
description: Adversarial slice-aware review of the latest round, posted as a marked PR comment
agent: plan
model: openrouter/deepseek/deepseek-v4.1-flash-1017
---

Issue/PR: $ARGUMENTS. Work only from
`.ai/<issue-number>-<slug>/round-N/{plan.md,diff-report.md}` where N is the
latest round. Reviews are delivered as PR comments, not files. The report's
first line is the marker `<!-- noisy-text-review: round=N -->`;
`round-N/review.json` is the reviewer's structured output, and `review.md` /
`review.html` are generated from it by `scripts/review-pack.mjs` (all
gitignored; `review.md` is the comment's `--body-file`, `review.html` is the
human's local reading view). No command reads them back.

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

2. Find the open PR for the branch and read its comments once; select the
   round-N comment (the STOP guard) and the round N-1 comment (prior findings)
   from the same fetch:

   ```bash
   PR=$(gh pr list --head <branch> --state open --json number --jq '.[0].number')
   gh pr view "$PR" --json comments --jq '[.comments[].body]'
   ```

   No open PR → STOP ("round N is implemented but not on a PR; run
   `/implement`"). If any comment starts with the round-N marker → STOP ("round
   N already reviewed; run `/plan` for a revision round — pass `next` if the
   verdict was `approve with nits` — or merge").

3. Prior findings: for N > 1 take the comment starting with the round N-1
   marker and pass it plus its `- Open findings:` list to the reviewer; if it
   is missing, STOP ("round N-1 has no review comment on the PR"). For N == 1,
   pass "none". Also read CI status with `gh pr checks "$PR"`.
4. Range facts (cheap, do them yourself):

   ```bash
   BASE=$(git merge-base origin/main HEAD)
   REVIEWED=$(git rev-parse --short HEAD)
   # N > 1: previous review's "Reviewed commit" → delta start
   git log --reverse --format='%h %s | %(trailers:key=Slice,valueonly,separator=)' "$START..HEAD"
   git diff --shortstat "$START..HEAD" -- . ':!.ai' ':!package-lock.json'
   ```

   `START` is `$BASE` for round 1 and the previous review's reviewed commit for
   N > 1. Count slice commits (commits with a `Slice:` trailer, excluding
   `Slice: report`) and the changed lines.

5. **Choose the mode.**
   - **single**: ≤ 3 slice commits **and** ≤ 600 changed lines in the range.
     Delegate once to the `reviewer` subagent (mode `single`).
   - **per-slice**: otherwise. Create the output directory first (the
     `slice-reviewer` subagents cannot create it):

     ```bash
     mkdir -p ".ai/<issue-number>-<slug>/round-N/slices"
     ```

     For each slice commit, delegate to a `slice-reviewer` subagent (Task tool,
     subagent_type `slice-reviewer`) with the slice id, commit sha, that slice's
     entry from `round-N/plan.md`, `CONVENTIONS.md`, and the output path
     `.ai/<issue-number>-<slug>/round-N/slices/S<k>.json`. Launch them in
     parallel, at most 6 at a time. Skip `Kind: mechanical` slices unless the
     diff touches more than barrels, types, docs, or the version; those get a
     one-line skim by the integrating reviewer. Skipped slices produce no JSON
     file. Then delegate once to the `reviewer` subagent (mode `integrate`) with
     only the slice files that were actually written.

   - Revision rounds (N > 1) are normally `single`: the range is a few
     fix-slices.

6. Delegate to the `reviewer` subagent (Task tool, subagent_type `reviewer`).
   Give it: the issue number, PR number, branch, round N, mode, artifact paths
   (`round-N/plan.md`, `round-N/diff-report.md`, prior review text when N > 1,
   slice JSON paths in integrate mode), CI status, merge base, reviewed commit,
   and the staging path `.ai/<issue-number>-<slug>/round-N/review.json`. It
   writes `review.json`, runs `scripts/review-pack.mjs` (which validates every
   cited line range and generates `review.md` and `review.html`), and posts the
   marked PR comment. This agent runs under plan mode and must not edit any
   other file.
7. Wait for its report (comment URL, `review.html` path, header block,
   blockers). Do not soften, rewrite, or re-format it. Trust the returned
   comment URL; if the reviewer reports that validation, the write, or the post
   failed, report that instead of writing or posting anything yourself.
8. Do not fix anything. End with a handoff summary: comment URL, the
   `review.html` path (tell the human to open it locally: it shows the diff
   one slice at a time, colour-coded, with mechanical slices collapsed),
   round number, mode used, verdict, `Open findings`, blockers. A non-approve
   verdict (`block` or `fix-and-recheck`) → run `/plan` (or `/implement <n>
fix` for small, fully specified findings) in a fresh session.
   `approve with nits` → the human decides merge or an explicit new round
   (`/plan <issue> next`); nits the human accepts should be filed as a
   follow-up issue rather than re-reviewed.
