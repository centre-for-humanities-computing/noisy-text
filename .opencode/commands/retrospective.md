---
description: Look back on an issue — read the record, write the journal and soil, commit and push
agent: reflector
---

Look back on `$ARGUMENTS`, an issue number. You read what happened, ask one
message of at most three questions, then write and commit. Never push to `main`
and never close the issue. Run this on a reviewed but unmerged PR as well as
after the merge; the two commit paths below keep the record on the PR branch
before, and on a fresh branch after.

## Read the record

- `node scripts/forge.mjs issue get <n> --json` for the latest
  `<!-- plan: N -->` (an old `round=N` counts; its Slices and Not doing), any
  `<!-- walk -->`, and the acceptance criteria.
- `git rev-parse --abbrev-ref HEAD`. The branch is `<n>-<slug>`.
- `node scripts/forge.mjs pr find --head <branch> --state all --json`, then
  `pr get <pr> --json` and `pr commits <pr> --json`: the review rounds, the
  commit bodies and any `Deviation:`, and the PR's own commit list.
- `git log <commits-range> --format=%B`, `git diff --stat <range>`, and
  `git show <sha> --stat` where a commit's shape matters.
- If the PR has merged, the branch may be gone: read `main`'s merge or squash
  commit (`git log main -1 --format=%B`). Its diff against the first parent is
  the range; if you cannot name it, say so and accept `unknown`.
Save what the facts script needs under `/tmp/opencode/`:

```bash
node scripts/forge.mjs issue get <n> --json > /tmp/opencode/issue-<n>.json
node scripts/forge.mjs pr get <pr> --json > /tmp/opencode/pr-<pr>.json
node scripts/forge.mjs pr commits <pr> --json > /tmp/opencode/commits-<pr>.json
node scripts/reflect-facts.mjs --range <range> --issue /tmp/opencode/issue-<n>.json \
  --pr /tmp/opencode/pr-<pr>.json --commits /tmp/opencode/commits-<pr>.json
```
Before the merge, churn is `main...HEAD` and the trailers are read from
`main..HEAD`; after it, both are `<sha>^..<sha>`. Pass the churn range.

Before asking, read the newest artefact — the issue body, the latest walk, the
plan, the field note or the review — and restate in one short list, in its
words, any question no later artefact answers. Wait: fold an answer into the
journal entry, and record an explicit "later" there as parked. When none are
open, restate nothing.

## Ask, then write

Open from a `Noticed:` line in the record or from an event it shows — a review
round, a deviation, a deleted file, a failed check or retry, a blocked round, a
slice over budget, a gap between estimated and actual churn. Ask at most three
questions in your own words; the Dalsgaard strategies guide the wording
(contrast, uncertainty, blind spot, counterpoint), not a list to rotate through.
When there is nothing to open from, say so and write only the facts.

Wait for the answer. One optional follow-up round is allowed when an answer is
thin or raises something you can check in the record; after that, write. Do not
turn this into a form.

Then append one entry to `.omhu/JOURNAL.md` in the human's words:

```md
## YYYY-MM-DD — retro — <the question you actually asked, or the event you opened from>

<their answer, one or two lines>
Facts: <the script's line without its "Facts: " prefix>
```

Tag any friction about the workflow itself with a line starting `[workflow]`.

Then make only the soil edits the answer supports: `.omhu/MAP.md` if the shape
of the code is clearer now, `.omhu/COMPOST.md` for an idea with a second need
or one newly deferred, `AGENTS.md` if how agents work changed. Do not rewrite
soil for its own sake. These are ordinary working-tree changes in the same
commit as the journal entry: the diff is the proposal, never applied silently
on `main`.

## Commit and push

Run the `verify` commands from `.omhu.json`; an empty list means there is no
automated gate. Then:

- **Before merge:** write the message under `/tmp/opencode/`, stage the soil
  with `git add .omhu AGENTS.md`, and commit on the PR branch with
  `git commit -F /tmp/opencode/<message>` and `Kind: mechanical` in the body, no
  `Slice:` trailer (the slice trailers still read as complete), then
  `git push origin <branch>`.
- **After merge:** `git switch -c retrospective-<n>-<YYYY-MM-DD> main` before
  writing, stage and commit the same way, and
  `git push -u origin retrospective-<n>-<YYYY-MM-DD>`. The human merges it; you
  never commit or push to `main`.

Report the branch, the commit, and the facts line. Do not close the issue.
