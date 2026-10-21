---
description: Produce a sliced implementation plan at .ai/<issue>-<slug>/round-N/plan.md
agent: plan
model: openrouter/deepseek/deepseek-v4.1-flash-1017
---

Issue: `$ARGUMENTS` — parse it before anything else. Grammar:
`<issue-number> [next] [large] [requirements text]`.

- The first token is the issue number (fetch title/body with `gh issue view`).
- `next` (literal) forces round N+1; everything after the flags is a
  human-authored requirements block for this round.
- `large` (literal; may follow the issue number directly or follow `next`)
  overrides the size gate in step 6. It never relaxes the per-slice budget.
- Any other extra token before the requirements text → STOP and ask.

Produce a plan concrete enough that a weaker implementer can execute it without
any further exploration, **and sliced so a human can review it one small commit
at a time**.

1. Confirm the issue exists and capture its title, body, and acceptance
   criteria.
2. Branch prep: verify you are on `<issue-number>-<slug>`
   (`git rev-parse --abbrev-ref HEAD`). If not, run `git switch <branch>` when
   the branch exists, otherwise `git switch -c <issue-number>-<slug>`. All
   work for this issue happens on that branch. Round 1 creates or checks out
   the branch; later rounds only verify it.
3. Derive the round:

   ```bash
   ISSUE_DIR=".ai/<issue-number>-<slug>"
   LATEST=$(ls -d "$ISSUE_DIR"/round-*/ 2>/dev/null | sort -V | tail -1)
   ```

   No output → round 1. Otherwise N is the number in `round-N/`. Commands
   never take a round argument, with one exception: a `next` token immediately
   after the issue number forces round N+1 — used only after an
   `approve with nits` verdict. If the artifact directory does not match the
   branch-derived name (deliberate stacking deviation), locate it manually; do
   not create a new one.

   Reviews live as marked PR comments, not files: fetch the latest review for
   round N from the open PR for the branch:

   ```bash
   PR=$(gh pr list --head <branch> --state open --json number --jq '.[0].number')
   gh pr view "$PR" --json comments --jq "[.comments[].body | select(startswith(\"<!-- noisy-text-review: round=$N -->\"))] | last"
   ```

4. Round rules:
   - No rounds yet → compose the normal round-1 plan; target
     `round-1/plan.md`.
   - `round-N/diff-report.md` missing → STOP: report "round N is planned but
     not implemented; run `/implement`".
   - `diff-report.md` present but no round-N review comment on the PR →
     STOP: report "round N is implemented but not reviewed; run `/review`".
   - Latest verdict `approve with nits` → STOP and report the verdict: the
     human decides merge or explicitly requests another round. Compose a
     revision plan only under the `next` override.
   - Latest verdict `block` or `fix-and-recheck` → compose a revision plan at
     `round-(N+1)/plan.md`, scoped to the finding IDs on that review's
     `- Open findings:` line; no unrelated changes.
   - A requirements block (text after the flags) is human-authorized and in
     scope by explicit instruction: the revision plan must satisfy it alongside
     any open findings. It is not scope creep, and it applies regardless of the
     latest verdict. Findings outside the `- Open findings:` line stay out of
     scope.
   - The `- Verdict:` header bullet of the review comment is the verdict
     contract; read its first occurrence.
5. Delegate reconnaissance to the `explore` subagent: exact files, existing
   helpers, registries, tests, per-directory `README.md` instructions. Require
   `file:line` evidence. Explore before writing anything. Also ask it to
   report, for each file you intend to touch, its current line count, so size
   estimates are grounded.
6. **Size gate (round 1 only).** Draft the slice list (see "Slicing rules"),
   sum the slice budgets, and compare:
   - Total estimate ≤ 1200 changed lines (insertions + deletions, tests
     included, `.ai/` and lockfiles excluded) → continue.
   - Total estimate > 1200 and no `large` token → do **not** write a plan.
     Reply with a proposed split into 2–4 follow-on issues: for each, a title,
     a one-sentence scope, which acceptance criteria it carries, its
     dependencies on the others, and an estimate. Split along seams where each
     piece is independently mergeable and reviewable (pure math/index →
     loading/IO → wiring → UI). Then STOP and ask the human whether to
     `/refine` the issue into these or re-run with `large`.
   - With `large`, continue, but every slice must still obey its budget; the
     plan simply has more slices.
   - Revision rounds are exempt; if a revision estimate exceeds 400 lines,
     say so in the plan's risks.
7. Read `CONVENTIONS.md` and the relevant per-directory READMEs.
8. Compose the complete plan markdown in chat, following the artifact style in
   `.ai/README.md` (headings and bullets; no tables). Required sections, in
   order:
   - Plan header (see below).
   - Goal and acceptance criteria (from the issue). Number them AC1, AC2, ….
   - When a requirements block was given, a `## New requirements` section that
     quotes the human's text verbatim and folds each requirement into the
     slices and acceptance criteria.
   - `## Slices` — the unit of implementation, commit, and review (see
     "Slicing rules").
   - `## Coverage` — one bullet per acceptance criterion, naming the slice(s)
     that satisfy it and the test or smoke step that proves it. An
     acceptance criterion with no slice must be explicitly marked deferred,
     with the follow-up issue number if one exists.
   - `## Smoke steps` — only when the issue changes user-visible behavior:
     3–5 steps, each `action → observable result`, stable enough to encode as
     one Playwright spec (`e2e/<slug>.spec.ts`, built in the last behavioral
     slice). Say which `data-testid`s must exist. Skip the section for pure
     engine work.
   - Verification: exact commands in order, per slice and per round (see
     below).
   - Edge cases, risks, out-of-scope items, open blocking questions.
   - Revision plans add `## Findings and actions`: one bullet per addressed
     finding ID mapping it to its slice (or an explicit no-change decision with
     rationale).

   Plan header, composed into the markdown (the plan-writer transcribes it
   verbatim). Initial plan:

   ```
   - Round: <N>
   - Addresses: none (initial plan)
   - Slices: <count>
   - Estimated size: <total> changed lines
   ```

   Revision plan:

   ```
   - Round: <N+1>
   - Addresses: R1-B1, R1-N3
   - Slices: <count>
   - Estimated size: <total> changed lines
   ```

   When a requirements block is present, append `; new requirements` to the
   `Addresses:` line.

### Slicing rules

A slice is one commit. The reviewer will read slices one at a time, so each
must be explainable in one sentence to a colleague who has not seen the repo.

- **One idea per slice.** If the idea needs "and", split it.
- **Budget:** behavioral ≤ 400 changed lines, tests included; target ≤ 250.
  Mechanical ≤ 150 unless purely generated or moved. State the estimate.
- **Mechanical vs behavioral never mix.** Moves, renames, reindentation,
  barrels (`index.ts`), READMEs, types-only files, and the version bump each
  get their own slice (several mechanical items may share one slice), marked
  `Kind: mechanical`, so the human can skim them in seconds.
- **Bottom-up order:** types and pure math → engine/index → worker/store
  plumbing → UI → docs/barrels → `e2e` spec → version bump (round 1 only,
  always last, `chore(#n): bump version to <x.y.z>`).
- **Bisectable:** after every slice `npm run check`, `lint`, `format`, and
  `test` pass. A slice may not call code introduced by a later slice. Tests go
  in the same slice as the code they test.
- **Algorithmic code** (selection/heaps, union-find, indexing, kernels,
  quantization) gets, in the same slice, a seeded randomized differential test
  against a naive reference implementation, not only hand-picked cases.
- **Specs first for hard slices:** if a slice has non-obvious math, write the
  `$...$` math comment as its first planned step.
- **Revision rounds:** one slice per finding (or tightly coupled group). A
  blocker's slice contains the failing regression test and the fix together.
  Commit subject: `fix(#<n>): R<r>-B<k> <summary>`.

Slice template (use exactly this shape):

```
### S<k> — <one-sentence idea>

- Kind: behavioral | mechanical
- Budget: <≤400> changed lines
- Files: `path` (create|modify) — exported signatures/types, data shapes
- Tests: `path` — cases (including the differential test where applicable)
- Covers: AC1, AC3
- Commit: `<type>(#<n>): <summary>`
- Reviewer note: 1–2 sentences — what the reviewer should convince themselves of
```

Verification block of the plan must say: per slice run
`node scripts/slice-check.mjs --budget <slice budget>` (which runs
`npm run check` → `lint` → `format` → `test`, stages, and checks the size); per
round, before pushing, `npm run test` once more and, if a `## Smoke steps`
section exists, `npm run e2e`.

9. This agent runs under plan mode and cannot edit files. Delegate the write
   to the `plan-writer` subagent (Task tool): pass the exact markdown and the
   target `.ai/<issue-number>-<slug>/round-<N>/plan.md` (slug must match the
   branch name). Then Read the file back; on any drift from what you composed,
   re-delegate.
10. Do not implement.

End with a short handoff summary: slice count, total estimate, the one-line
idea of each slice, and ask the human to confirm before `/implement`.
