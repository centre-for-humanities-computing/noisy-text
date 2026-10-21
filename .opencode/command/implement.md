---
description: Implement a confirmed round plan slice by slice, open PR, write diff report
agent: build
model: openrouter/z-ai/glm-5.3-flash
---

Issue: $ARGUMENTS (number, optionally followed by the literal `fix`). Work only
from `.ai/<issue-number>-<slug>/round-N/plan.md` where N is the latest round.

1. Branch check: `git rev-parse --abbrev-ref HEAD` must be
   `<issue-number>-<slug>`. If not, STOP and ask — do not implement on the
   wrong branch. The working tree must be clean: `git status --porcelain` must
   print nothing. One exception: `/plan` writes `round-N/plan.md` but does not
   commit it, so the plan artifact may sit untracked when `/implement` starts.
   If `git status --porcelain` shows only untracked
   `.ai/<issue-number>-<slug>/round-N/plan.md` (or the fix-mode plan written in
   step 2) — plus any modified `.opencode/` workflow files changed while
   starting the round — commit them together as the round's first commit,
   before slice S1: subject `docs(#<n>): add round <N> plan`, trailers
   `Slice: plan` / `Kind: mechanical`, body explaining what the round plans.
   Then the tree must be clean. Any other dirt → STOP.
2. Derive the round (same snippet as `/plan`; commands never take a round
   argument):

   ```bash
   ISSUE_DIR=".ai/<issue-number>-<slug>"
   LATEST=$(ls -d "$ISSUE_DIR"/round-*/ 2>/dev/null | sort -V | tail -1)
   ```

   No output → STOP: there is no round-1 plan yet; run `/plan`.

   **`fix` mode (optional shortcut for small revision rounds).** If the second
   token is `fix`, the latest round N must be implemented and reviewed with
   verdict `block` or `fix-and-recheck`, and every open finding must carry a
   concrete fix in its review comment. Fetch the review as `/plan` does, then
   write `round-(N+1)/plan.md` yourself with the normal header
   (`Addresses: <ids>`), one slice per finding (regression test + fix in the
   same slice, `Kind: behavioral`), budgets from the finding text, and
   `## Findings and actions`. If any finding is vague, needs a design choice,
   or you estimate more than ~150 changed lines in total, STOP and tell the
   human to run `/plan` instead. Then continue with step 3 using this plan.

3. Read `round-N/plan.md` and `CONVENTIONS.md`. STOP if `round-N/plan.md` is
   missing. STOP if `round-N/diff-report.md` exists ("round N already
   implemented; run `/review`"). If the plan is incomplete, has no `## Slices`
   section, or contradicts the code, STOP and ask — do not guess.
4. Implement **slice by slice, in plan order**. For each slice S<k>:
   1. Implement exactly that slice, nothing from later slices, no scope creep.
   2. Run `node scripts/slice-check.mjs --budget <slice budget>`. It runs
      `npm run check` → `lint` → `format` → `test` (printing only the tail of a
      failure), stages everything, and reports the changed-line count.
   3. On a verification failure, fix only what this slice broke and re-run.
      After two failed attempts, STOP: leave earlier commits in place (each is
      green) and report which slice failed and why.
   4. Size: the script exits 2 when the slice is more than 25% over budget.
      Then split it into commits `S<k>a`, `S<k>b`, … by file or by idea
      (each still green), or if it cannot be split cleanly, STOP and ask. Never
      shrink a slice by dropping planned tests.
   5. Commit once per slice. Subject from the plan. Body of 3–5 lines written
      for the human reviewer: what the slice does, why, how it was verified.
      End the message with git trailers, exactly:

      ```
      <type>(#<n>): <summary>

      <what / why / how verified, 3-5 lines>

      Slice: S<k>/<total>
      Kind: behavioral
      ```

      (`Kind:` is `behavioral` or `mechanical`, copied from the plan. A split
      slice uses `Slice: S<k>a/<total>`.) Use
      `git commit -F <file under /tmp>` or repeated `-m` so the trailers land
      on their own lines.

5. Version: bump `package.json` per SemVer (`CONVENTIONS.md` §Versioning:
   breaking → major, `feat` → minor, otherwise patch) only when `N == 1`, in
   the plan's final mechanical slice. Revision rounds leave the version
   untouched (one bump per issue).
6. If the plan has `## Smoke steps`, the plan's e2e slice adds
   `e2e/<slug>.spec.ts`. Before pushing run `npm run e2e` once and fix only
   what you broke; if the failure is a missing `data-testid` or an app bug the
   plan did not cover, STOP and ask rather than weakening the assertion.
7. Final check before the report: `npm run test` once more on the whole tree.
8. Write `.ai/<issue-number>-<slug>/round-N/diff-report.md`. The commit log
   already explains each slice, so this report is **short** — it records only
   what git cannot. Begin with:

   ```
   - Round: <N>
   - Commits: <count> (<first short sha>..<last short sha>)
   ```

   Then these sections, bullets only, no tables, no per-file narrative:
   - `## Deviations from the plan` — any slice split, reordered, dropped, or
     enlarged, and why. `None` if none.
   - `## Known limitations and residual risk`.
   - `## Not exercised` — code paths with no automated test (e.g. IndexedDB
     under node), and what you did instead.
   - `## Verification` — results of the final `npm run test`, `npm run e2e` if
     run, and the last `slice-check` summary.

   The report is committed as its own final commit
   (`docs(#<n>): add round <N> diff report`, trailer `Kind: mechanical`,
   `Slice: report`). The `/review` reviewer verifies it against the actual
   diff, so keep it honest.

9. Push, then reuse the PR if one exists:

   ```bash
   gh pr list --head <issue-number>-<slug> --state open --json number,url
   ```

   Build the change summary from the slice commits
   (`git log --reverse --format='- %h %s' <base>..HEAD`), not from memory.

   Non-empty → `git push`, then
   `gh pr comment <number> --body "<round <N> change summary: the slice list,
one paragraph on what changed and why, verification results>"`.
   Empty → `git push -u origin <issue-number>-<slug>` then
   `gh pr create --base main --head <issue-number>-<slug> --title "<type>(#<issue-number>): <summary>" --body "<slice list, `Closes #<issue-number>`, verification results>"`.
   Never merge.

End with a handoff summary: round number, PR URL, slice count and total size,
what to check, what comes next (`/review`, which posts its report as a marked
comment on this PR). Remind the human that GitHub's PR "Commits" tab shows one
slice at a time.
