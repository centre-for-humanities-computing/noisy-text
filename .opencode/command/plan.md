---
description: Produce a concrete implementation plan at .ai/<issue>-<slug>/plan.md
agent: plan
model: openrouter/deepseek/deepseek-v4.1-flash
---

Issue: $ARGUMENTS (issue number; fetch title/body with `gh issue view`).

Produce a plan concrete enough that a weaker implementer can execute it without
any further exploration.

1. Confirm the issue exists and capture its title, body, and acceptance
   criteria.
2. Branch prep: verify you are on `<issue-number>-<slug>`
   (`git rev-parse --abbrev-ref HEAD`). If not, run `git switch <branch>` when
   the branch exists, otherwise `git switch -c <issue-number>-<slug>`. All
   work for this issue happens on that branch.
3. Delegate reconnaissance to the `explore` subagent: exact files, existing
   helpers, registries, tests, per-directory `README.md` instructions. Require
   `file:line` evidence. Explore before writing anything.
4. Read `CONVENTIONS.md` and the relevant per-directory READMEs.
5. Compose the complete plan markdown in chat, following the artifact style in
   `.ai/README.md` (headings and bullets; no tables). Required sections:
   - Goal and acceptance criteria (from the issue).
   - Files to create/modify: exact path, exported signatures/types, data shapes.
   - Ordered step-by-step implementation steps.
   - Tests to add (path + cases) and exact verification commands in order:
     `npm run check` → `npm run lint` → `npm run format` → `npm run test`.
   - Edge cases, risks, out-of-scope items, open blocking questions.
6. This agent runs under plan mode and cannot edit files. Delegate the write
   to the `plan-writer` subagent (Task tool): pass the exact markdown and the
   target `.ai/<issue-number>-<slug>/plan.md` (slug must match the branch
   name). Then Read the file back; on any drift from what you composed,
   re-delegate.
7. Do not implement.

End with a short handoff summary and ask the human to confirm before
`/implement`.
