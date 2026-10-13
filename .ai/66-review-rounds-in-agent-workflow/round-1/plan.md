# Plan: Issue #66 — Support review rounds in the plan → implement → review loop

- Round: 1
- Addresses: none (initial plan)
- Branch: `66-review-rounds-in-agent-workflow`, stacked on
  `63-update-opencode-setup-for-the-project` (local `56811db` plus the
  uncommitted #63 review follow-up).

## Goal and acceptance criteria

Goal: repeated plan → implement → review rounds on the same branch and PR, with
full history. Round 1 is a normal plan; round N+1 is a revision plan scoped to
round N's open findings. Commands derive the round with no extra arguments.

Acceptance criteria (issue #66):

- Round 2+ runs with no extra arguments and does not overwrite round 1.
- A non-approve verdict leads to a revision plan mapping findings to actions.
- The next review reports the status of every prior finding with evidence.
- `/implement` on a branch with an existing PR updates it instead of recreating
  it.
- `check`, `lint`, `format`, `test`, `prettier --check` pass; agents resolve.

## Locked decisions

- **Layout.** `.ai/<issue-number>-<slug>/round-N/{plan.md,diff-report.md,review.md}`.
  Flat artifacts (issue #63) are legacy; migrating them is the issue's optional
  follow-up, out of scope here.
- **Round derivation.** `round-*` directories sorted numerically; no round
  directories → round 1. Commands never take a round argument.
- **Verdicts.** `block`, `fix-and-recheck`, `approve with nits`. The first two
  loop to a new `/plan`; `approve with nits` does not (the human decides merge
  or explicitly asks for another round). No round cap.
- **Headers.** Plan `Round` + `Addresses`; diff report `Round` + `Commits`;
  review `Round` + `Reviewed commit` + `Verdict` + `Open findings`.
- **Git.** One commit per round, same branch; `package.json` bumped once per
  issue (round 1 only).
- **Escape hatch.** `/refine` when a review shows the issue scope itself is
  wrong.
- No new dependencies; no change to the read-only plan/review agents or the
  subagent write model.

## Branch prep (before `/implement`; `/plan` cannot run it under plan mode)

Current state: branch `63-update-opencode-setup-for-the-project`, commit
`56811db`, working tree dirty with #63 review follow-up fixes; no PR exists;
local `main` is stale (`b488770`) while `origin/main` is `d5a1b03`.

1. Commit #63's pending fixes on branch 63 (exclude the untracked
   `.ai/66-review-rounds-in-agent-workflow/`):

   ```bash
   git add .ai/63-update-opencode-setup-for-the-project .opencode AGENTS.md CONVENTIONS.md .ai/README.md .prettierignore
   git commit -m "fix(#63): address round-1 review findings"
   ```

2. Push and open #63's PR:

   ```bash
   git push -u origin 63-update-opencode-setup-for-the-project
   gh pr create --base main --head 63-update-opencode-setup-for-the-project \
     --title "chore(#63): update opencode setup and agent docs" \
     --body "Closes #63. <verification results>"
   ```

3. Create the stacked 66 branch from 63's tip:

   ```bash
   git switch -c 66-review-rounds-in-agent-workflow
   ```

   The untracked `.ai/66-review-rounds-in-agent-workflow/` plan carries over.

4. `/implement` refuses to run unless HEAD is
   `66-review-rounds-in-agent-workflow`.

## Files to create/modify

### `.ai/README.md`

- Layout block becomes
  `.ai/<issue-number>-<slug>/round-N/{plan.md,diff-report.md,review.md}`;
  example branch name `66-review-rounds-in-agent-workflow`.
- Add a `## Rounds` section:
  - One `round-N/` per pass; round 1 is the initial plan; round N+1 is a
    revision plan scoped to round N's open findings.
  - Commands derive the latest round from `round-*/` (numeric max) with no
    extra arguments.
  - Loop policy: `block` and `fix-and-recheck` loop to a new `/plan`;
    `approve with nits` ends the loop (human decides merge or a new round); no
    round cap; commands surface the round number and repeated findings; fresh
    session per round.
  - `/refine` is the escape hatch when the issue scope itself is wrong.
  - One commit per round; `package.json` bumped once per issue.
  - Artifact headers as listed under "Locked decisions".
- Keep the subagent write model and branch notes; `/plan` creates or checks out
  the branch in round 1 and only verifies it in later rounds.

### `.opencode/agent/reviewer.md`

- Inputs: add the round number N, the report path under `round-N/`, the
  previous round's `review.md` (or none), the reviewed commit, and both diff
  commands: delta `git diff <previous Reviewed commit>..HEAD` (N > 1) and
  cumulative `gh pr diff <pr>` or `git diff origin/main...HEAD`.
- Replace the current `## Verdict` section with a header block:

  ```
  # Review: Issue #<n> — <title>

  - Round: <N>
  - Reviewed commit: `<short sha>`
  - Verdict: `<block|fix-and-recheck|approve with nits>` — <one-line justification>
  - Open findings: `<comma-separated finding IDs>` | none
  ```

- Add `## Previous findings status` before `## Blockers`: one bullet per
  finding on the previous review's `- Open findings:` line, with status
  `fixed` / `still open` / `superseded` and evidence (`file:line`, test name,
  or command output). Round 1: `- No previous findings (round 1).`
- Verdict semantics: `approve with nits` only when no blocker and no required
  action remains; `Open findings` lists the nits, or the findings requiring
  action including still-open prior findings.
- Keep `## Blockers`, `## Non-blocking concerns`, `## Missing tests and
  verification gaps`, `## Open questions for the author`, and the verbatim
  write to the report path.

### `.opencode/command/plan.md`

- Frontmatter description: `.../round-N/plan.md`.
- After branch prep, derive the round:

  ```bash
  ISSUE_DIR=".ai/<issue-number>-<slug>"
  LATEST=$(ls -d "$ISSUE_DIR"/round-*/ 2>/dev/null | sort -V | tail -1)
  ```

  No output → round 1. Otherwise N is the number in `round-N/`.
- Round rules:
  - No rounds → compose the normal round-1 plan; target `round-1/plan.md`.
  - Latest round N has no `review.md` → STOP: report "round N is not reviewed
    yet; run `/review`".
  - Latest verdict `approve with nits` → STOP: report the verdict; the human
    decides merge or explicitly requests another round.
  - Latest verdict `block` or `fix-and-recheck` → compose a revision plan at
    `round-(N+1)/plan.md`, scoped to the IDs on the review's
    `- Open findings:` line; no unrelated changes.
- Plan header (composed into the markdown; the plan-writer transcribes it
  verbatim):

  ```
  - Round: <N>
  - Addresses: none (initial plan)
  ```

  or, for a revision plan:

  ```
  - Round: <N+1>
  - Addresses: round-<N> findings B1, N3
  ```

- Revision plans add `## Findings and actions`: one bullet per addressed
  finding ID mapping it to concrete file-level actions (or an explicit
  no-change decision with rationale).
- Keep explore → CONVENTIONS/READMEs → compose → plan-writer → read-back →
  handoff.

### `.opencode/command/implement.md`

- Derive the latest round N (same snippet). Read `round-N/plan.md`; STOP if it
  is missing. STOP if `round-N/diff-report.md` exists ("round N already
  implemented; run `/review`").
- Implement exactly the plan; no scope creep.
- Version: bump `package.json` per `CONVENTIONS.md §Versioning` only when
  `N == 1`; revision rounds leave the version untouched (once per issue).
- Keep the verification order `npm run check` → `npm run lint` →
  `npm run format` → `npm run test`.
- Write `round-N/diff-report.md` with the header:

  ```
  - Round: <N>
  - Commits: <type>(#<n>): <summary> (round <N>)
  ```

  This records the subject of the round's single commit; the report is
  committed with that commit, so the sha is not known beforehand
  (`git log -1 --format=%h` gives it). Keep per-file what/why/plan mapping and
  verification results.
- One commit per round: stage all changes including the diff report and run
  `git commit -m "<type>(#<n>): <summary> (round <N>)"`. Round 1 uses the
  issue's type (`feat`); revision rounds use `fix`.
- Push, then reuse the PR:

  ```bash
  gh pr list --head <branch> --state open --json number,url
  ```

  Non-empty → `git push` and report the existing URL. Empty →
  `git push -u origin <branch>` then `gh pr create --base main --head <branch>
  --title "<type>(#<n>): <summary>" --body "... Closes #<n> ... verification
  results"`. Never merge.
- Handoff: PR URL, what to check, `/review`.

### `.opencode/command/review.md`

- Frontmatter description: `.../round-N/review.md`.
- Derive the latest round N. Require `round-N/diff-report.md`; STOP if it is
  missing. STOP if `round-N/review.md` exists ("round N already reviewed; run
  `/plan` for a revision or merge").
- Prior findings: for N > 1 read `round-(N-1)/review.md` and pass it plus its
  `- Open findings:` list to the reviewer. For N == 1, pass "none".
- Reviewed commit: `git rev-parse --short HEAD`. Delta diff for N > 1:
  `git diff <previous review's Reviewed commit>..HEAD`. Cumulative:
  `gh pr diff <pr>` if a PR exists, else `git diff origin/main...HEAD` (local
  `main` can be stale).
- Delegate to the `reviewer` subagent with issue number, branch, N, artifact
  paths (`round-N/plan.md`, `round-N/diff-report.md`, prior review when N > 1),
  report path `round-N/review.md`, the reviewed commit, and the diff commands.
  Verify the write with Read; do not edit.
- Handoff: report path, verdict, `Open findings`, blockers. Non-approve verdict
  → run `/plan` for the next round in a fresh session; `approve with nits` →
  the human decides merge or a new round. Replace the current "send blockers
  back to `/implement`" line.

### `.opencode/command/refine.md`

- Add one line: when a review shows the issue scope itself is wrong, `/refine`
  is the escape hatch — refine the GitHub issue, then start a fresh `/plan`;
  do not loop on a mis-scoped plan.

### `AGENTS.md`

- Workflow paragraph: artifacts live in
  `.ai/<issue-number>-<slug>/round-N/`; non-approve verdicts loop to the next
  round's revision plan with no round cap; one commit per round; `package.json`
  bumped once per issue; fresh session per round; `/refine` escape hatch.

### `CONVENTIONS.md` (§Versioning)

- Clarify: bumped once per issue — in the round-1 commit; later review rounds
  commit fixes without another bump. Keep the SemVer table.

### `package.json`

- `1.2.0` → `1.3.0` (issue is `feat` → minor), round 1 only.

## Ordered implementation steps

1. Branch prep (see above) — human or build agent, before `/implement`.
2. `.ai/README.md`: rounds layout, `## Rounds` policy, header list.
3. `.opencode/agent/reviewer.md`: header, `## Previous findings status`,
   inputs, verdict semantics.
4. `.opencode/command/plan.md`: round derivation, revision mode, headers.
5. `.opencode/command/implement.md`: latest-round plan, version-once,
   diff-report path/header, one commit per round, PR reuse.
6. `.opencode/command/review.md`: latest-round review, prior findings,
   reviewed commit, delta diff.
7. `.opencode/command/refine.md`: escape-hatch line.
8. `AGENTS.md` and `CONVENTIONS.md` wording.
9. `package.json` bump.
10. Verification (below).

## Tests to add

None — the change is markdown prompts and config; there is no executable code.
The vitest suite must stay green. Behavioral acceptance (round 2+ runs, PR
reuse, finding-status reporting) is exercised on the next real review cycle and
cannot be unit-tested here.

## Verification

1. `npm run check`
2. `npm run lint`
3. `npm run format`
4. `npm run test`
5. `npx prettier --check .`
6. `opencode debug agent plan-writer` — edit only under `.ai/**`, bash denied.
7. `opencode debug agent reviewer` — edit only under `.ai/**`, bash allowlist
   unchanged.
8. `opencode debug agent plan` — read-only outside `.ai/**`.
9. Note: the issue's `opencode debug agent plan-writer reviewer` prints CLI
   help because the command takes exactly one agent name; run the two
   invocations above separately.
10. Remind the human to restart opencode so command/agent edits load.

## Edge cases and risks

- **Legacy flat artifacts (#63).** Commands only read `round-*/`; #63's flat
  files stay as-is. Migration is the issue's optional follow-up, out of scope.
- **Stacked branch.** PR 66 includes #63's commit until #63 merges; the
  review's `Reviewed commit` keeps round reviews scoped to the delta.
- **`sort -V` portability.** GNU sort is available here; on macOS use
  `sort -t- -k2 -n` as a fallback.
- **Verdict parsing.** The exact `- Verdict:` header bullet is the contract;
  commands read the first match in `review.md`.
- **Pre-commit sha in the diff report.** The report is committed with the
  round's commit, so `Commits` records the subject; the sha is available via
  `git log -1`.
- **Stop states.** `/plan` on an unreviewed round, `/implement` on an
  implemented round, and `/review` on a reviewed round must stop and report
  rather than overwrite.
- **`approve with nits`.** Does not auto-loop; the human decides merge or an
  explicit new round.
- **Local `main` is stale** (`b488770` vs `origin/main` `d5a1b03`); use
  `origin/main` or `gh pr diff` for cumulative diffs.

## Out of scope

- No automated loop command; no round-cap enforcement.
- No change to the read-only plan/review agents or the subagent write model.
- No new dependencies.
- No migration of #63 to `round-1/` (optional follow-up).
- No CI changes.

## Open blocking questions

None. Confirmed with the human: stack 66 on 63; branch and slug
`66-review-rounds-in-agent-workflow`.
