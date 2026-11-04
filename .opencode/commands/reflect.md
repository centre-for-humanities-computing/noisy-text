---
description: Reflect on the present — pause mid-work, ask where this is going, write the journal and soil, commit
agent: reflector
---

Reflect on `$ARGUMENTS`, an optional issue number or topic. You read the
present, ask one message of at most three questions, then write and commit.
Never push to `main` and never close the issue. With no argument, look at the
current branch and say so in one line.

## Read the present

- `git rev-parse --abbrev-ref HEAD` and `git status --porcelain`.
- `git diff` and `git diff --stat` for the working tree; `git log -3 --format=%B`
  for the last commits.
- When an issue is named, `node scripts/forge.mjs issue get <n> --json` for its
  body, its latest `<!-- walk -->` and its latest `<!-- plan: N -->`, and say in
  one line which question no later artefact answers.
- The newest entry in `.omhu/JOURNAL.md`, and only the soil the present touches.

## Ask, then write

Open from where the work is going: the branch, the working diff, the newest
journal entry, the question the named issue leaves open. Ask at most three
questions about direction, whether the decisions still hold, and what
alternatives remain; the Dalsgaard strategies guide the wording (contrast,
uncertainty, blind spot, counterpoint), not a list to rotate through.

Wait for the answer. One optional follow-up round is allowed when an answer is
thin or raises something you can check in the tree; after that, write. Do not
turn this into a form.

Then append one entry to `.omhu/JOURNAL.md` in the human's words:

```md
## YYYY-MM-DD — reflect — <the question you actually asked>

<their answer, one or two lines>
```

No `Facts:` line: this pause reads the present, not the record. Tag any
friction about the workflow itself with a line starting `[workflow]`.

Then make only the soil edits the answer supports: `.omhu/MAP.md` if the shape
of the code is clearer now, `.omhu/COMPOST.md` for an idea with a second need
or one newly deferred, `AGENTS.md` if how agents work changed. Do not rewrite
soil for its own sake. These are ordinary working-tree changes in the same
commit as the journal entry: the diff is the proposal, never applied silently
on `main`.

## Commit and push

Run the `verify` commands from `.omhu.json`; an empty list means there is no
automated gate. Then:

- **On a branch:** write the message under `/tmp/opencode/`, stage the soil with
  `git add .omhu AGENTS.md`, and commit on the current branch with
  `git commit -F /tmp/opencode/<message>` and `Kind: mechanical` in the body, no
  `Slice:` trailer, then `git push origin <branch>`.
- **From `main`:** `git switch -c reflect-<YYYY-MM-DD> main` first, or
  `reflect-<n>-<YYYY-MM-DD>` when an issue was named, then stage and commit the
  same way, and `git push -u origin <branch>`. The human merges it; you never
  commit or push to `main`.

Report the branch and the commit. Do not close the issue.
