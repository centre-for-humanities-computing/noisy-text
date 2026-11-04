---
description: Plan an issue — post a short, approvable plan as a marked issue comment
agent: planner
---

Plan `$ARGUMENTS`. The first token is the issue number; anything after it is a
note from the human — an implementation surprise, a changed requirement, a review
concern. You read and you speak; you edit no project files. The only thing you
write is one comment on the issue, then you wait. Planning is optional — a
trivial fix can go straight to implementation — so never invent a missing input;
ask for it. The number is required; a note is not.

## Read, then speak first

Fetch the issue with `node scripts/forge.mjs issue get <number> --json` and read
its body, its acceptance criteria and its comments. Read the latest
`<!-- walk -->` comment: its answers are decisions already made. When a fact the
plan rests on may have moved, search the web with `websearch` and cite the URL.

Then read the current branch and its pull request. `git rev-parse --abbrev-ref
HEAD` names the branch; `node scripts/forge.mjs pr find --head <branch> --json`
finds the open pull request; `node scripts/forge.mjs pr get <pr> --json` returns
it. The field note is its body when it has no comments, otherwise the newest
comment that is no `<!-- review: round=N -->` marker; say which you read. The
newest marker is the review: name its round and its verdict, and restate its
blockers in your own words, never copied. An approval has no blockers, so round
and verdict are the whole of it. With no pull request, say so, name the branch
you looked at, and plan from the issue and the walk as today.

Every note you were given is folded into the plan and named in its opening line,
in your own words rather than quoted: the plan has one page, and a pasted
surprise spends it on itself. Where a note contradicts the walk, say the note
wins on that point.

Before composing, read the newest artefact — the issue body, the latest walk, a
newer plan or a review — and restate in one short list, in its words, any
question no later artefact answers. Wait: fold an answer into the new plan, and
record an explicit "later" there as parked so the next command does not ask
again. When none are open, restate nothing.

Never post a second note without being asked. Before composing, say in plain
prose what the existing plan covers (if a plan comment exists) and what the
issue asks now, then ask what this plan should do — revise it (naming the parts
that changed), plan again from scratch, or stop — and wait. Notes change the
answer, not the ask: a note never carries the plan past this question.

A `Tend:` or `Dream:` title is its own plan: the body is plan 1 and already
carries the slices, the compost decisions and the Not doing lines. Say so, name
`/implement <number>`, and post no comment.

If there is no walk comment, ask: walk first, or plan from the issue alone?

Two cases skip the question. Nothing is planned yet, so plan 1 composes straight
away. And a `<!-- review: round=` comment newer than the plan is already the
instruction: plan for its blockers without asking, and name the review round you
answer.

## Compose

Your marker is `<!-- plan: N -->`, one past the latest plan comment's number, or
`plan: 1`. An old `<!-- plan: round=N -->` counts as N. Write one comment, at
most about one page, with these sections in order:

1. **Story** — one or two paragraphs in the issue's own words: what changes,
   why, and how you will try it. Domain language, no signatures, no file lists.
2. **Smallest version** — the minimal option first, what it leaves out and the
   rough cost. Argue for anything beyond it; deletions count in its favour.
3. **Soil check** — the existing code and patterns it grows from, what it could
   replace or delete, and one small tending item of at most about 30 lines in
   the same area.
4. **Not doing** — what is deferred, one line each; each also gets a line in
   `.omhu/COMPOST.md` when the work lands.
5. **Slices** — one sentence each, with kind (behavioral or mechanical) and a
   line budget. One slice is one commit.
6. **Net lines** — added and deleted, as an estimate.

A revision plan uses the same sections, scoped to the review's blockers.

## Size gate

If the plan needs more than four slices or more than about 500 changed lines,
post a proposed split into follow-on issues instead of a plan: for each, a
title, a one-sentence scope, the acceptance criteria it carries, its
dependencies, and an estimate. Post it as a plain comment, with no plan marker,
then stop.

## Post and stop

Write the comment to `/tmp/opencode/plan-<number>.md` with the write tool, then
run:

```bash
node scripts/forge.mjs issue comment <number> --body-file /tmp/opencode/plan-<number>.md
```

End the comment with one line on whether the diff needs an agent review — "small
enough to read the diff yourself" or "this deserves a review" — then name the
next step: `/implement <number>`, or the first step you would run.

When the record shows something happened — a `Deviation:`, a failed check or
retry or STOP, a deleted file, a blocked round, a slice over budget, a gap
between estimated and actual churn, two implementation paths to compare, or, for
a plan, a draft that would sharpen against a counterpoint — state what you
noticed or ask one question in your own words before you post. The Dalsgaard
strategies guide the wording (contrast, uncertainty, blind spot, counterpoint);
they are not a list to rotate through. Carry a `Noticed:` line typed anywhere in
the session into the plan comment in the human's words. When nothing happened,
nothing is asked; skipping is not scolded.

Then wait for the human's reply. Do not start implementing, and do not write to
`.omhu/` — reflect does that.
