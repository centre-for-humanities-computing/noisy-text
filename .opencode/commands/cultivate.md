---
description: Cultivate an issue — read the issue drafts, the soil and the code, then mature one into the house shape once you confirm
agent: cultivator
---

Cultivate `$ARGUMENTS`: a bare number is an existing issue you mature, anything
else is free text you cultivate into a new issue, and an empty argument picks
from what is already there. There is no flag. You read and speak, edit no code,
and write nothing until you confirm.

## Read, then speak first

- Read `AGENTS.md`, `.omhu/MAP.md`, the last five entries of `.omhu/JOURNAL.md`
  and `.omhu/COMPOST.md`, as `/walk` does. A journal lesson or a COMPOST line is
  a source: keep it.
- List the backlog with `node scripts/forge.mjs issue search "" --json` and keep
  the open rows: they are candidates and the duplicate check. Search returns no
  body, so `issue get` each open row before calling it an issue draft — a body
  still `TBD` or with no acceptance criteria is one. If the forge refuses an
  empty query, search two or three distinctive words instead.
- For a number, fetch it with `node scripts/forge.mjs issue get <number> --json`.
  For either form, find the code the work would touch and read it: every claim
  about the code is grounded in `file:line`.
- List the open milestones with `node scripts/forge.mjs milestone list --json`
  and keep them in view.
- When an outside fact the issue rests on may have moved, search the web with
  `websearch` and cite the URL; keep model knowledge marked as recollection.

When `$ARGUMENTS` is empty, list the three sources — the open issue drafts, the
last five journal entries, the compost lines — one line each with where it came
from, and ask which to mature. Do not invent an idea from empty free text.

Before cultivating, name any open issue that already covers the idea — search two
or three distinctive words and `issue get` each open candidate before naming it,
because search returns no body — and ask whether to mature that one instead. Then
say what the issue is really about and what you would do, and only then write.

Ask which open milestone the issue belongs to, with that list in front of you;
"none" is a real answer. It is a question, not an argument. The chosen title
rides on the create or edit command, and split children inherit the parent's
milestone.

## The shape

Write the title first, then the body in this order:

- **Size:** n slices, about m changed lines. **Depends on:** the issues it needs,
  or none. **Compost:** the one line it came from, when that is the source; a line
  named in an open issue's Compost line is already scheduled, not promoted again.
- **Story.** One or two paragraphs in the issue's own words: what changes, why,
  and how you would try it.
- **Acceptance criteria.** Numbered AC1…, each observable by a test, a command,
  or a named observation. An AC you cannot check is rewritten or flagged under
  Open questions; it is not quietly kept.
- **Not doing.** One line each: what is deferred, and why.
- **Open questions.** What is still a decision, one line each.

## Size gate

Four slices and about 400 changed lines is the ceiling. Larger work becomes a
split into independently mergeable issues, each with a title, one-sentence scope,
size, dependencies and the acceptance criteria it carries. For a new issue,
confirmation creates the children; for an existing one, the parent is rewritten
as a short umbrella naming them, and you say plainly that you must close it by
hand. Never split silently.

## Confirm, then write

Show the draft in chat and stop: the title, the old→new summary for an existing
issue, and the whole body. Name any `<!-- walk -->` or `<!-- plan: -->` comment
the issue already has and ask whether to re-walk, re-plan or keep it. Comments
are never deleted — a newer numbered walk or plan supersedes, it does not erase.

On confirmation, write each body you showed to `/tmp/opencode/cultivate-<slug>.md`
(or `-<n>.md` per child) and run the matching commands: one `issue create` for a
single issue, one per child for a split, then `issue edit` the parent when it
exists. Pass `--milestone "<title>"` to every `issue create` and `issue edit`
when a milestone was chosen.

```bash
node scripts/forge.mjs issue create --title "<title>" --body-file /tmp/opencode/cultivate-<slug>.md [--milestone "<title>"]
node scripts/forge.mjs issue edit <number> --title "<title>" --body-file /tmp/opencode/cultivate-<slug>.md [--milestone "<title>"]
```

`--title` is optional on an edit when the title does not change. Then say the
number and stop: the walk and the plan are the next steps, and `/implement` owns
the branch, the slices and the PR. Write no soil and no commit.
