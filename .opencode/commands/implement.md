---
description: Implement an approved plan slice by slice, then push and open the PR
agent: build
---

Implement issue `$ARGUMENTS`. The first token is the number; an optional second
token `step` builds one slice and stops with a note.

## Before coding

1. Check the branch. `git rev-parse --abbrev-ref HEAD` must be `<n>-<slug>`.
   Otherwise use the single existing branch named `<n>-*`; if none exists,
   create `<n>-<slug>` from `main` (slug from the issue title). More than one
   candidate, or a dirty tree → STOP and ask. `git status --porcelain` must be
   empty before the first slice.
2. Fetch `node scripts/forge.mjs issue get <n> --json`. Find the newest plan:
   a `<!-- plan: N -->` or old `<!-- plan: round=N -->` comment. A `Tend:` or
   `Dream:` title is its own plan, numbered 1, so no comment is needed: a
   `Tend:` body holds its picks as slices and its compost decisions, a `Dream:`
   body the soil change it agreed. Ask for `/plan` only if the body is not
   plan-shaped. Read the slices, their kinds and budgets, the Not
   doing lines, and any tending item. No plan → STOP and ask for `/plan`.
3. Find the PR with `node scripts/forge.mjs pr find --head <branch> --json` and
   read `pr get <pr> --json` for the newest `<!-- review: round=N -->` and its
   `Verdict:`. No PR is fine: there is no review.
4. Resume, do not restart. Read `git log --format=%B main..HEAD`. A commit's
   `Plan: N` names the plan it answers; a commit with no `Plan:` is plan 1
   (legacy). `Fixes: review N` answers review N and has no `Slice:`. The newest
   instruction — plan or review by its comment time — is current. For a plan N,
   take the highest `Slice: k/n` under `Plan: N` and resume at k+1 (1 when
   none); a total that disagrees, or k > n, is a STOP. For a block review N,
   read its blockers and the `Fixes: review N` commits and implement any
   blocker not yet fixed. If current is answered — plan N at `n/n`, review N
   with every blocker fixed — do not invent n+1; in `step` mode say so and
   point to a non-step run, else Finish. A newer plan starts at slice 1 and names the older slices it
   abandons; do not rewrite them. `step` keeps no state: the trailers are its
   memory.

Before the first slice, read the newest artefact — the issue body, the latest
walk, the plan, the field note or a review — and restate in one short list, in
its words, any question no later artefact answers. Wait: fold an answer into the
field note, and record an explicit "later" there as parked. When none are open,
restate nothing.

## Per slice

Before editing, state the slice's sentence, any assumption, and whether a
simpler path exists. If the slice is ambiguous, or the plan contradicts the
code, STOP and ask. Never pull work forward from a later slice.

Build only what that sentence asks. Match the surrounding style, leave
neighbouring code alone, and delete only what your own change orphaned. Search
the web with `websearch` when the slice's API is in doubt, and cite the URL.
Green verify defines done, not "it looks right"; when the list is empty there is
no automated gate.

A simpler deviation inside the slice's idea is allowed — record it in the
slice commit body as `Deviation: ...`, then carry it into the field note. A
deviation that changes what the slice is about is a STOP.

Then for slice k of n:

1. Run `node scripts/slice-check.mjs --budget <the plan's budget>`. Omit
   `--budget` only when the plan names none. It runs verify (or says there is
   no automated gate when the list is empty), stages the tree,
   and reports churn. Verify failure: fix only what this slice broke and retry;
   after two attempts STOP and leave earlier commits in place. Over budget:
   STOP and ask, unless a smaller version still does the slice's job.
2. Commit once. Subject from the plan, a 3–5 line body saying what, why and how
   it was verified, then these trailers on their own lines:

   ```
   Plan: N
   Slice: k/n
   Kind: behavioral
   ```

   `Plan` is the number of the plan comment, or 1 when step 2 found the body is
   its own plan; a legacy plan-less commit is also 1. A review fix replaces
   `Plan:` and `Slice:` with `Fixes: review N`, keeping `Kind:`. `Kind` is
   copied from the plan
   (`behavioral` or `mechanical`). Write the message to
   `/tmp/opencode/commit-<n>-<k>.md` and use `git commit -F`.

3. In `step` mode, stop here — including after the last slice — with exactly:
   what grew (one line), one thing to try, and `Continue?`. Do not push. A
   later `/implement <n> step` resumes from the trailers.
4. Without `step`, go straight on to the next slice.

The last slice is the soil slice, `Kind: mechanical`: append the plan's Not
doing lines to `.omhu/COMPOST.md`, delete the compost lines a `Tend:` body marks
deleted and the line the issue's `**Compost:**` line names when it has one, leave
a `Promoted:` line for the issue it was handed to, update `.omhu/MAP.md` only if
the shape of the code changed, and include the plan's tending item if it named
one. If the session held a `Noticed:` line, append it to `.omhu/JOURNAL.md` as
this phase's entry, dated and in the human's words. No version bump unless
`AGENTS.md` states a versioning rule.

## Finish (no `step` only)

When every slice is committed, run verify once more, then `git push` (set the
upstream with `git push -u origin <branch>` if needed). Find an open PR with
`node scripts/forge.mjs pr find --head <branch> --json`.

- Existing PR: post the field note with
  `node scripts/forge.mjs pr comment <number> --body-file <path>`.
- No PR: write the body and run
  `node scripts/forge.mjs pr create --base main --head <branch> --title "<type>(#<n>): <summary>" --body-file <path>`.

The field note is the PR description: what grew in at most five sentences, how
to try it in three or four steps, the one place to read first, and any allowed
deviation copied from the commit bodies. End by naming the next step: `/review
<pr>`, then `/retrospective <n>` after the merge.

The body named at `pr create` carries `Closes #<n>` on its own line, after the
field note and before the next-step line, so the merge closes the issue.

When the record shows something happened — a `Deviation:`, a failed check or
retry or STOP, a deleted file, a blocked round, a slice over budget, a gap
between estimated and actual churn, or two implementation paths to compare —
state what you noticed or ask one question in your own words before writing the
field note. The Dalsgaard strategies guide the wording (contrast, uncertainty,
blind spot, counterpoint); they are not a list to rotate through. Carry a
`Noticed:` line typed anywhere in the session into the field note in the human's
words. When nothing happened, nothing is asked; skipping is not scolded.

Report the PR URL and how many slices this run committed. Never merge.
