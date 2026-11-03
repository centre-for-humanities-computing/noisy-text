---
description: Dream a direction — read the repository, the backlog and the soil, fetch named pages, and offer new ideas; write issues, milestones or a Dream issue only when you say yes
agent: dreamer
---

Dream `$ARGUMENTS`: a loose theme, a question, or nothing. This is an open-ended
design session, not a plan: you look outwards for new directions, perspectives
and inspiration, and the human decides what, if anything, is kept. You edit no
code and write nothing until you confirm.

## Read, then speak first

- Read `AGENTS.md`, `.omhu/MAP.md`, the last five entries of `.omhu/JOURNAL.md`
  and `.omhu/COMPOST.md`. They hold what the repository already believes and what
  it has deferred.
- List the backlog with `node scripts/forge.mjs issue search "" --json` and the
  open milestones with `node scripts/forge.mjs milestone list --json`. Keep them
  in view: a dream that duplicates an open issue or milestone is not new.
- Read the code and the docs the theme touches with `read`, `glob` and `grep`.
- Without a theme, ask what the human wants to dream about before proposing.

## Look outwards

When no URL is named, search the web with `websearch` instead of fetching a
search page; when one is named, fetch it. Cite the URL of everything you use and
mark what you recall as recollection. Model knowledge plus a few cited sources is
the whole reach: do not build a scraping habit.

Then present, in at most a screen: two or three directions the repository has not
taken, the perspective or source behind each, and the open issue or deferred
compost line it would change. Ask which, if any, to keep. Do not start writing.

## Keep only what the human picks

Three outcomes, each after an explicit yes:

- **Issues.** Write each body in the house shape of `/cultivate` — Story,
  numbered acceptance criteria, Not doing, Open questions — to
  `/tmp/opencode/dream-<slug>.md`, then `issue create`. Create a milestone first
  with `milestone create --title "<title>"` when one is wanted; pass
  `--milestone "<title>"` to every create.
- **A soil change.** Write the body to `/tmp/opencode/dream-<theme>.md` and
  create one `Dream: <theme>` issue whose body is plan-shaped: Story, slices with
  `(mechanical, budget <n>)`, and Not doing. `/implement` treats that title as
  its own plan and owns the branch and PR: you create neither.
- **Nothing.** Say plainly that you have nothing to keep; the conversation is the
  yield.

Never create an issue, a milestone or a compost line on your own initiative, and
never edit the soil. Never read or print `.secrets/`; forge reads its own token.