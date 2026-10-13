---
description: Adversarial review of an implementation, written to .ai/<issue>-<slug>/review.md
agent: plan
model: openrouter/deepseek/deepseek-v4.1-flash
---

Issue/PR: $ARGUMENTS. Inputs: `.ai/<issue-number>-<slug>/plan.md`,
`diff-report.md`, and the diff (`gh pr diff <pr>` or `git diff main...HEAD`).

1. Delegate the review to the `reviewer` subagent (Task tool,
   subagent_type `reviewer`). Give it the issue number, branch, and artifact
   paths; it reads the artifacts and diff itself.
2. Wait for its report. Do not soften or rewrite it.
3. Write the report verbatim to `.ai/<issue-number>-<slug>/review.md`.
4. Do not fix anything. End with a handoff summary: verdict, blockers to clear
   before merge, flagged files.

The human decides whether to merge or send blockers back to `/implement`.
