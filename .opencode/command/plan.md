---
description: Produce a concrete implementation plan at .ai/<issue>-<slug>/round-N/plan.md
agent: plan
model: openrouter/deepseek/deepseek-v4.1-flash
---

Issue: `$ARGUMENTS` — parse it before anything else. The first token is the
issue number (fetch title/body with `gh issue view`). If the next token is
literally `next`, force round N+1 and treat everything after `next` as a
human-authored requirements block for this round. Any other extra token → STOP
and ask; the only arguments are `<issue-number>`, optional `next`, and optional
trailing text.

Produce a plan concrete enough that a weaker implementer can execute it without
any further exploration.

1. Confirm the issue exists and capture its title, body, and acceptance
   criteria.
2. Branch prep: verify you are on `<issue-number>-<slug>`
   (`git rev-parse --abbrev-ref HEAD`). If not, run `git switch <branch>` when
   the branch exists, otherwise `git switch -c <issue-number>-<slug>`. All
   work for this issue happens on that branch. Round 1 creates or checks out
   the branch; later rounds only verify it.
3. Derive the round:

   ```bash
   ISSUE_DIR=".ai/<issue-number>-<slug>"
   LATEST=$(ls -d "$ISSUE_DIR"/round-*/ 2>/dev/null | sort -V | tail -1)
   ```

   No output → round 1. Otherwise N is the number in `round-N/`. Commands
   never take a round argument, with one exception: a `next` token immediately
   after the issue number (`/plan 66 next`, or
   `/plan 66 next add a loading spinner`) forces round N+1 — used only after an
   `approve with nits` verdict. Any text after `next` is a requirements block
   (step 4). If the artifact directory does not match the branch-derived name
   (deliberate stacking deviation), locate it manually; do not create a new
   one.

   Reviews live as marked PR comments, not files: fetch the latest review for
   round N (and, when composing a revision plan, for round N as the prior
   round) from the open PR for the branch:

   ```bash
   PR=$(gh pr list --head <branch> --state open --json number --jq '.[0].number')
   gh pr view "$PR" --json comments --jq "[.comments[].body | select(startswith(\"<!-- noisy-text-review: round=$N -->\"))] | last"
   ```

4. Round rules:
   - No rounds yet → compose the normal round-1 plan; target
     `round-1/plan.md`.
   - `round-N/diff-report.md` missing → STOP: report "round N is planned but
     not implemented; run `/implement`".
   - `diff-report.md` present but no round-N review comment on the PR →
     STOP: report "round N is implemented but not reviewed; run `/review`".
   - Latest verdict `approve with nits` → STOP and report the verdict: the
     human decides merge or explicitly requests another round. Compose a
     revision plan only under the `next` override.
   - Latest verdict `block` or `fix-and-recheck` → compose a revision plan at
     `round-(N+1)/plan.md`, scoped to the finding IDs on that review's
     `- Open findings:` line; no unrelated changes.
   - A requirements block (text after `next`) is human-authorized and in scope
     by explicit instruction: the revision plan must satisfy it alongside any
     open findings. It is not scope creep, and it applies regardless of the
     latest verdict — with `block` / `fix-and-recheck` it folds into the
     pending round. Findings outside the `- Open findings:` line still stay out
     of scope.
   - The `- Verdict:` header bullet of the review comment is the verdict
     contract; read its first occurrence.
5. Delegate reconnaissance to the `explore` subagent: exact files, existing
   helpers, registries, tests, per-directory `README.md` instructions. Require
   `file:line` evidence. Explore before writing anything.
6. Read `CONVENTIONS.md` and the relevant per-directory READMEs.
7. Compose the complete plan markdown in chat, following the artifact style in
   `.ai/README.md` (headings and bullets; no tables). Required sections:
   - Goal and acceptance criteria (from the issue).
   - When a requirements block was given, a `## New requirements` section that
     quotes the human's text verbatim and folds each requirement into the steps
     and acceptance criteria.
   - Files to create/modify: exact path, exported signatures/types, data shapes.
   - Expected reviewable surface: which files/areas change, roughly how much,
     and which changes are mechanical (moves, renames, reindentation) versus
     behavioral, so the reviewer knows the budget.
   - Ordered step-by-step implementation steps.
   - Tests to add (path + cases) and exact verification commands in order:
     `npm run check` → `npm run lint` → `npm run format` → `npm run test`.
   - Edge cases, risks, out-of-scope items, open blocking questions.
   - Plan header, composed into the markdown (the plan-writer transcribes it
     verbatim). Initial plan:

     ```
     - Round: <N>
     - Addresses: none (initial plan)
     ```

     Revision plan:

     ```
     - Round: <N+1>
     - Addresses: R1-B1, R1-N3
     ```

     When a requirements block is present, append `; new requirements` to the
     `Addresses:` line.

   - Revision plans add `## Findings and actions`: one bullet per addressed
     finding ID mapping it to concrete file-level actions (or an explicit
     no-change decision with rationale).

8. This agent runs under plan mode and cannot edit files. Delegate the write
   to the `plan-writer` subagent (Task tool): pass the exact markdown and the
   target `.ai/<issue-number>-<slug>/round-<N>/plan.md` (slug must match the
   branch name). Then Read the file back; on any drift from what you composed,
   re-delegate.
9. Do not implement.

End with a short handoff summary and ask the human to confirm before
`/implement`.
