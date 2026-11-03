---
description: Tend an area — read the soil and the code, propose at most three simplifications, and create the Tend issue once the human picks
agent: gardener
---

Tend `$ARGUMENTS`: a path (`scripts/`, one file), a theme (`the prompts`), or
nothing for the whole repository. You simplify code that already behaves: delete,
merge, rename, extract, move — no new capability, dependency or observable
change, and `node --test` green before and after. You read and speak, then wait.

## Read first

- `.omhu/MAP.md`, and the last five entries of `.omhu/JOURNAL.md`.
- The `.omhu/COMPOST.md` lines in scope: those matching the path or theme, or all
  of them when `$ARGUMENTS` is empty.
- The code area and its recent history: `git log` and `git show` on the files you
  would touch. If `$ARGUMENTS` is an issue number, read it with
  `node scripts/forge.mjs issue get <number> --json` and let its area set the scope.

## Speak first, then propose

Say what is there and what looks awkward — the dead code, the two abstractions
that say the same thing, the test of a fact nobody argues with, the doc that
describes a codebase that is gone, the name that lies, the helper a file away
from its only caller. Ask two or three real questions about taste, then wait.

The proposal is at most three picks, one screen, each naming:

- what leaves or sharpens: a file, a function, a duplicate pair, a test, a
  paragraph of doc, a name;
- the rough churn, added and deleted lines — a move counts both sides;
- the risk of being wrong — what breaks if the pick is mistaken.

A pick may add a few lines to remove a name, a concept or a hop the reader was
carrying; it may not add a concept. New capability is a grow issue, not a pick.
If nothing is worth simplifying, say so and stop: no issue, no note, no branch.

## Settle the compost in scope

Mark each line **keep** (the default; leave it unmentioned), **delete** (dead,
built, or stale in the code as it is now), or **promote** (a second independent
need appeared). At most two promotions, each only after the human confirms it.
A promotion is handed to `/cultivate <the line>` and stays in `.omhu/COMPOST.md`
until that issue lands; you never draft it. A line already named in an open
issue's `**Compost:**` line is kept and named, not promoted again.

## Create the issue, then hand off

Only after the picks are approved, write the body to
`/tmp/opencode/tend-<theme>.md`, then run:

```bash
node scripts/forge.mjs issue create --title "Tend: <theme>" --body-file /tmp/opencode/tend-<theme>.md
```

The theme is one or two words a branch slug can carry; the title names one
removal or one clearer name — `Tend: remove local forge`, never `Tend:
repository`. A pass that only deletes a dead compost line or promotes one still
creates the issue; a promotion-only pass names `/cultivate <line>` next. A pass
with no pick and no compost decision creates none.

The body is the plan `/implement` grows, in `/cultivate`'s order:

- **Size:** n slices, about m changed lines. **Depends on:** the issues it needs,
  or none. **Compost:** the deleted lines, each with what was decided; anything
  unmentioned was kept. **Promoted:** the lines handed to `/cultivate <line>`,
  which stay in `.omhu/COMPOST.md` until that issue lands.
- **Story.** What this pass looked at, and why these picks.
- **Acceptance criteria.** Numbered AC1…, each observable by a test, a command or
  a named observation; a pick that adds lines earns a reader's-gain observation.
- **Slices.** One line per pick: the subject, one sentence, and
  `(mechanical, budget 150)`. Every slice is `Kind: mechanical`: behaviour is
  preserved, `node --test` is green before and after. A move is churn, not
  growth; its budget counts both sides. Exceed 150 lines only with your say-so in
  the slice line.
- **Not doing.** One line each; they reach `.omhu/COMPOST.md` with the work.

Then say the issue number and stop; `/implement <number>` owns the branch, the
commits and the PR. A structural pick — rename, extract, move, merge — says the
PR wants `/review <pr>`; a pure deletion or doc edit is yours to read.
