---
description: Refine a draft issue into concrete, session-sized GitHub issue text
agent: plan
model: openrouter/deepseek/deepseek-v4.1-flash
---

You are refining a conceptual draft issue for the noisy-text repository into
one or more implementable GitHub issues.

Input: $ARGUMENTS (paste the draft, or give an existing issue number).

Steps:

1. Delegate codebase reconnaissance to the `explore` subagent: does the
   feature already exist? Which files would it touch? Which existing
   abstractions apply? Ask for `file:line` answers.
2. Read only the relevant sections of `AGENT_CONTEXT.md` and `DESIGN.md`.
3. Produce refined issue text in chat (do NOT write files):
   - Title (`feat:`/`fix:` scope), context, scope, explicit non-goals,
     acceptance criteria, verification commands, dependency on other issues.
   - If the draft is too large for one fresh session, split it into ordered,
     independently mergeable issues and state what blocks what.
4. End with a handoff: list the exact `gh issue create ...` / `gh issue edit`
   commands for the human to run after review. Do not run them.

This phase produces Git issues, not `.ai/` files.

Escape hatch: when a review shows the issue scope itself is wrong, use
`/refine` — refine the GitHub issue, then start a fresh `/plan`. Do not loop
on a mis-scoped plan.
