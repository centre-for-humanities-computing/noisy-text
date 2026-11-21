# Journal

Your own words, one entry per phase when there is something to say: one
reflection, at a phase end, in your own words.
Format: `## YYYY-MM-DD — phase — question`, then your answer in a line or two.
Tag a line `[workflow]` when the friction was with the workflow itself.

## 2026-11-03 — implement — what broke, and what held?

Noticed: the deletion estimate was ~9,500 and the commit was 9,486, so the
arithmetic held and only the budget broke — 9,486 lines nobody needs to read,
in the same branch as a 100-line diff that does. Also, `scripts/forge.mjs`
carried an uncommitted change in the working tree, so the first slice-check
would have swept it into S1; it was stashed before `/implement`.

## 2026-11-04 — retro — why the install commit arrived unplanned, and what its 1,170-line format debt says

The installer needs to format its files so that debt is not pushed to consumers — it is not that it would produce formatted files but that it should. The install is exempt only as a bootstrap: the workflow cannot plan itself into existence.
[workflow] The dead `':!.ai'` staging guard and the `.claude/` ignore are parked, not proven — they return only if something can write there again.
[workflow] The four-command gate is two commands here: `reflector.md` allows check and test, not lint or prettier — the reviewer's round-2 gap, still open for this agent.
Facts: 0 walks · 3 review rounds · 4 slices · +3434/−11113

## 2026-11-04 — implement — slice count and commit shape

Noticed: the issue estimates one or two commits; this is four slices because the copy, unit evidence, e2e evidence and docs are separate kinds and each stays far under budget. If you prefer the issue's shape, S1 and S2 can merge into one ~225-line behavioral commit, leaving three.

## 2026-11-05 — retro — what let the status double-count through, and what would have caught it before review?

"I don't know, honestly." S1's message claimed `50 000` while the code passed the effective size, and the e2e pinned only `(+n OOV)`, so nothing failed.
Commit-subject accuracy "is not that important" — the worry is overoptimizing. Round 2's tidy notes are "later": many things to tidy, they do no harm.
[workflow] Missing issue numbers in subjects drew a review note; the human would rather not overoptimize commit prose.
Facts: 1 walk · 2 review rounds · 1 slice · +341/−30

## 2026-11-11 — implement — what grew, and what is still untested?

The WordNet path now runs exporter → bundle + manifest → IndexedDB loader → typed table, with four planned slices plus this soil commit. S2 landed at 175 changed lines against its 140 estimate because the synthetic fixture and four loader tests dominate. The Python exporter was exercised against the real OEWN 2025 archive but has no checked-in test, and coverage's denominator (letter-bearing tokens only, OOV included and uncovered) is the easiest thing to get subtly wrong; both are review targets. Nothing consumes the table until #94.

## 2026-11-17 — retro — the gloss still promises a drift the seeds do not show; where does the promise go?

Reword the gloss to what one draw over five categories actually gives, and leave AC1 visibly unmet rather than quietly redefining it. The overshoot was genuine: the merged noun/verb row and the resource-object refactor made the work larger than the plan could see. Hand-checking the user-visible half stands for now; a wordnet e2e spec is parked in COMPOST.
Facts: 1 walk · 1 review round · 4 slices · +525/−67

## 2026-11-17 — retro — the retrospective itself, and why it is being skipped

"I've started skipping retrospectives at an alarming rate," and the one just run was disappointing: three not-very-interesting questions with pre-written answers, not a reflection on the process of the issue or milestone. It has to improve if it is going to be valuable.
[workflow] The fixed three-question shape with option lists turns reflection into a form; these questions did not reach the process of #94.
Facts: 1 walk · 1 review round · 4 slices · +525/−67

## 2026-11-17 — implement — what did the estimates miss?

Noticed: the plan guessed ~6 MB for the bundle and the export landed at 4.05 MB — the label blob is under 1 MB, not the ~3 MB assumed, so richer labels would fit. Churn came in at 487 added / 215 deleted against a ~430 estimate because the shared fixture and the loader tests rewrite around the v2 section order rather than one hand-built bundle.

## 2026-11-21 — implement — the walk's answers overruled its own bullets

Noticed: the walk's "Decided" bullets kept M2–M6 as five slots with click inside M2, but its later "Still open" answers gave click its own milestone and dropped the numbers; the later answers won. AC5's "only through `milestone edit --description`" was narrower than that answer — the renames needed `--title` and the new milestone needed `create` — so the table names every title change.
