---
description: Adversarial review of an implementation, written to .ai/<issue>-<slug>/review.md
agent: plan
model: openrouter/deepseek/deepseek-v4.1-flash
---

Issue/PR: $ARGUMENTS. Inputs: `.ai/<issue-number>-<slug>/plan.md`,
`diff-report.md`, and the diff (`gh pr diff <pr>` or `git diff main...HEAD`).

1. Determine `<issue-number>-<slug>` from the current branch
   (`git rev-parse --abbrev-ref HEAD`) and confirm the folder
   `.ai/<issue-number>-<slug>/` exists; derive the report path
   `.ai/<issue-number>-<slug>/review.md`.
2. Delegate the review to the `reviewer` subagent (Task tool,
   subagent_type `reviewer`). Give it the issue number, branch, artifact
   paths, the report path, and the diff command; it reads everything itself.
   The reviewer follows the artifact style in `.ai/README.md` and writes its
   report to the report path itself — this agent runs under plan mode and
   must not edit files.
3. Wait for its report. Do not soften, rewrite, or re-format it. Verify with
   Read that `.ai/<issue-number>-<slug>/review.md` exists and holds the full
   report from the reviewer; if the write failed, report that instead of
   writing anything yourself.
4. Do not fix anything. End with a handoff summary: written report path,
   verdict, blockers to clear before merge, flagged files.

The human decides whether to merge or send blockers back to `/implement`.
