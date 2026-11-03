---
description: Review a pull request commit by commit, check every citation, and post one marked comment
agent: reviewer
---

Review `$ARGUMENTS`, a pull request number. You read, try and speak; you edit no
project files. The only writes are scratch under `/tmp/opencode/` and one comment.

## Read first

- `AGENTS.md`, then `.omhu/REVIEW_PRIORITIES.md`. If the second is missing, say
  so and continue. A violated invariant is a blocker; nothing else is.
- The branch is `<issue>-<slug>`: `git rev-parse --abbrev-ref HEAD`; the leading
  number is the issue. Read it with `node scripts/forge.mjs issue get <issue>
  --json` — its latest `<!-- plan: N -->` comment (an old `round=N` counts) and
  its acceptance criteria.
- `node scripts/forge.mjs pr get <pr> --json`. No open PR → STOP. If its `head`
  is not `git rev-parse --abbrev-ref HEAD`, STOP and ask to check out the PR
  branch; never review or post on another branch.

Before picking the range, read the newest artefact — the issue body, the latest
walk, the plan, the field note or the previous review — and restate in one short
list, in its words, any question no later artefact answers. Wait: fold an answer
into the review comment, and record an explicit "later" there as parked. When
none are open, restate nothing.

## Pick the range and the round

- The latest `<!-- review: round=N -->` comment on the PR is the previous round;
  its `Reviewed commit: <sha>` line is where the next round starts.
- No review comment → round 1: read every commit in
  `git log --reverse --format=%h main..HEAD`, one `git show <sha>` at a time.
- Otherwise round N+1: read only `<previous Reviewed commit>..HEAD`. If that
  range is empty, STOP and ask; an empty range is not a round. If a round N+1
  comment already exists, STOP and ask before posting a second one.
- The new `Reviewed commit` is `git log -1 --format=%H`.

## Try

Read `AGENTS.md` and the invariants before the diff. For a suspected bug, write
a scratch script under `/tmp/opencode/`, run it with
`node /tmp/opencode/<script>`, and keep its output as the repro. The `verify`
commands from `.omhu.json` are the only other check; an empty list means there
is no automated gate.

Only a bug you reproduced, or an invariant you can name and point at, is a
blocker. An unmet acceptance criterion, a slice over its budget, a wording
concern or a nit is a stewardship note and never causes a round.

## The comment

At most four findings in total across blockers and notes, then a separate
three-line list of what could be deleted or simplified. Cite only backticked
`path:start-end` (or `path:line`) at the reviewed commit. A deleted line is
quoted in the finding, never cited; cite the failing repro or a surviving line.
Prose and fenced output are not citations.

````md
<!-- review: round=N -->
Reviewed commit: <sha>

**Verdict:** block | approve

**Blockers**
- <what breaks> `path:start-end` — repro: `node /tmp/opencode/...` gives <output>

**Stewardship notes**
- <concern, unmet criterion, slice budget, or nit>

**What could be deleted or simplified**
- <at most three lines>
````

Write it to `/tmp/opencode/review-<pr>.md`, then run
`node scripts/cite-check.mjs <reviewed-commit> /tmp/opencode/review-<pr>.md`.
Any failure: fix the comment, rerun, and do not post until it passes.

Post with
`node scripts/forge.mjs pr comment <pr> --body-file /tmp/opencode/review-<pr>.md`.

## Handoff

Say in plain prose what you tried and what you could not check. If this is round
2 or later with an open blocker, offer three choices — merge anyway, file a
follow-up issue (title and body), or continue with `/plan` or `/implement` (a
`Fixes: review N` commit) — and wait. Otherwise name the next step: try the PR
from the field note, then `/retrospective <issue>` after the merge.

Carry a `Noticed:` line typed anywhere before the comment is posted into the
review comment in the human's words. Review posts before the human has tried
anything, so it does not ask a question; skipping is not scolded.
