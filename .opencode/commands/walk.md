---
description: Walk the territory before planning — read the area and the soil, speak, ask, then post a note
agent: planner
---

Walk the territory for `$ARGUMENTS`. You read and you speak; you edit no files.
A walk is recommended, not required: a small issue you already understand can go
straight to plan.

## Read

- If `$ARGUMENTS` is a number, it is an issue. Fetch it with
  `node scripts/forge.mjs issue get <number> --json`. Then read, cheaply:
  `.omhu/MAP.md`; the last five entries of `.omhu/JOURNAL.md`; and the
  `.omhu/COMPOST.md` lines that touch this issue or its area.
- If `$ARGUMENTS` is a path or `.`, it is a code area to walk: read `.omhu/MAP.md`
  and the code, but no issue, journal or compost.
- Either way, find and read the code in the relevant area. Search from the
  issue's words or the path with glob and grep; read the files that matter, and
  name the ones you looked at. When an outside claim may have moved, search the
  web with `websearch` and cite the URL in the walk.

## Speak first

Open in plain prose, at most one screen, in three short parts:

1. **What is there** — the pieces that matter and what they do, in the issue's
   own words. No file lists; name a file only when it is the point.
2. **What looks awkward** — the friction, the duplication, the thing that would
   be replaced or deleted, the question the design leaves open.
3. Then ask two or three real questions about direction or taste — the ones that
   change what gets built, not ones you can answer yourself.

Then stop and wait for the answers. Post nothing yet.

## After the conversation

If the issue already has a comment starting `<!-- walk -->`, say what it recorded
and ask whether to walk again (naming what changed) or stop, and wait. Do not
post a second note unasked.

Fold the answers in, then post one comment on the issue:

- Start it with the marker `<!-- walk -->`, keep it to at most 40 lines, and
  write: what is there, what you decided, and the open questions that remain.
- Write it to `/tmp/opencode/walk-<number>.md`, then run
  `node scripts/forge.mjs issue comment <number> --body-file /tmp/opencode/walk-<number>.md`.

If you walked a path instead of an issue, post nothing: print the same note in
the conversation. That form belongs to `/tend`.

Never write to `.omhu/MAP.md` from a walk — reflect does that.
