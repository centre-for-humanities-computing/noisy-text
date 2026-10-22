- Round: 2
- Addresses: R1-N1, R1-N2, R1-N3, R1-N4, R1-N5, R1-N6, R1-N7; new requirements
- Slices: 7
- Estimated size: 440 changed lines

# Issue #74 — Try to make slice reviewing more economical (round 2)

## Goal and acceptance criteria

Round 1 built the packet pipeline. Round 2 closes the seven non-blocking
findings from the round-1 review and removes the configuration/prose tests that
issue #74 added, keeping only tests that pin behavior.

Issue acceptance criteria (carried over from round 1; unchanged here):

- **AC1:** `scripts/slice-pack.mjs` writes one self-contained packet per slice
  commit containing the plan entry, the applicable review focus,
  script-computed facts, and the commit diff with 10 lines of context. A slice
  reviewer can complete its review in one model call without reading files or
  running commands.
- **AC2:** Per-slice review judges only correctness and test adequacy, reports
  at most 3 findings, makes no reproduction attempts, and leaves budget, kind,
  and tests-in-slice checks to the packet's script facts.
- **AC3:** A slice with fewer than 60 changed lines is skipped unless it
  touches a review-priority path. Mechanical slices are skipped unless they
  touch one. All skipped slices are reviewed together in the integrator's
  pass.
- **AC4:** The three review subagents expose only the tools they need:
  `slice-reviewer` and `plan-writer` write only their artifact, and `reviewer`
  has no web, subagent, or MCP tools.
- **AC5:** In per-slice mode the integrator verifies only blockers and
  high-confidence findings, reproduces only the blockers it keeps, and does not
  re-verify every candidate.

New acceptance criteria for this round:

- **AC6:** Tests added by issue #74 that only string-match configuration,
  agent/command prose, rendered packet text, or trivial id/path mappings are
  removed.
- **AC7:** The remaining tests in `scripts/` assert observable behavior only:
  plan parsing, the skip decision, CLI guards, and output refresh. No test
  reads a file under `.opencode/`.

## New requirements

The human supplied this requirements block verbatim:

> There is a lot of test-bloat. Please be critical of the tests and only keep
> those that test meaningful behavior and remove those that merely string-match
> on the configuration. Since this repo is mostly a configuration-repo, I
> expect that only few tests will remain, if any.

Scope confirmed with the human during planning: prune **only the tests added by
issue #74** — `scripts/review-workflow.test.ts` and
`scripts/slice-pack.test.ts`. App, engine, strategy, schedule, store, and e2e
tests are out of scope.

Requirement mapping:

- **Remove configuration string-matches.** S1 deletes
  `scripts/review-workflow.test.ts` outright; all four of its cases read
  `.opencode/agent/*.md` or `.opencode/command/review.md` and assert literal
  sentences. S2 deletes the `renderIndex`/`renderPacket`/`renderSkipped` cases
  (exact rendered prose) and the `planIdFor`/`priorityFor` cases (static id and
  path-prefix mappings).
- **Keep meaningful behavior.** S2 keeps the two parser cases and the three
  skip-decision cases. S3–S5 and S7 add only regression tests for behavior that
  the open findings change.
- **"Only few tests remain."** Issue #74's test surface drops from 14 cases to
  5 behavior cases after S1–S2. The five regression cases added for the
  findings are behavior tests, not configuration matches; no test reads
  `.opencode/` afterwards.

## Slices

### S1 — Delete the agent/command configuration-prose test file

- Kind: mechanical
- Budget: 60 changed lines
- Files: `scripts/review-workflow.test.ts` (delete) — 57 lines, 4 cases that
  `readFileSync` `.opencode/agent/slice-reviewer.md`,
  `.opencode/agent/reviewer.md`, and `.opencode/command/review.md` and assert
  literal prose/frontmatter strings.
- Tests: none; the file is the test.
- Covers: AC6
- Commit: `test(#74): remove agent configuration prose tests`
- Reviewer note: confirm no file imports or references it and no other test
  reads `.opencode/`. The agent behavior it asserted is configuration, not
  executable behavior.

### S2 — Keep only parser and skip-decision tests in slice-pack

- Kind: mechanical
- Budget: 130 changed lines
- Files: `scripts/slice-pack.test.ts` (modify) — reduce 214 lines to about 90:
  remove the `planIdFor`, `priorityFor`, `renderIndex`, `renderPacket`, and
  `renderSkipped` imports and `describe` blocks; keep the `PLAN` fixture, the
  two `parsePlanSlices` cases, and the three `decide` cases.
- Tests: `scripts/slice-pack.test.ts` — parser (wrapped `Files` continuation,
  verbatim entry) and `decide` (priority beats mechanical/tiny, mechanical
  short-circuits, 59/60 threshold).
- Covers: AC6, AC7
- Commit: `test(#74): keep only slice parser and decision tests`
- Reviewer note: the removed cases assert exact output strings or echo static
  mappings; the kept cases fail if the heading reset, skip precedence, or
  60-line boundary changes.

### S3 — Join wrapped plan fields for every bullet and pin the heading boundary

- Kind: behavioral
- Budget: 90 changed lines
- Files: `scripts/slice-pack.mjs` (modify) — in `parsePlanSlices` (34–109),
  track the active field for every recognized bullet, including `Kind`,
  `Budget`, `Covers`, and `Commit`, not only `Files`, `Tests`, and
  `Reviewer note`. Add one continuation rule: if the accumulated value ends
  with `-`, drop that hyphen and concatenate the trimmed continuation with no
  space (so `behav-` + `ioral` is `behavioral`, and `12-` + `0 changed lines`
  is `120 changed lines`); otherwise join with one space. Reset the field on a
  blank line and on any `##`/`###` heading. Parse the budget number from the
  fully joined value, not from the first bullet line.
  `scripts/slice-pack.test.ts` (modify) — extend the fixture so S1 has a wrapped
  `Kind` (`behav-` / `  ioral`) and a wrapped `Budget` (`12-` /
  `  0 changed lines`); assert `kind === 'behavioral'` and `budget === 120`. In
  the boundary case, assert `slices[1]?.kind === 'mechanical'` and that
  `slices[1]?.entry` does not contain `Not a slice heading`.
- Tests: `scripts/slice-pack.test.ts` — parser cases above.
- Covers: R1-N1, R1-N6, AC7
- Commit: `fix(#74): R1-N1 join wrapped plan fields`
- Reviewer note: the hyphen rule fixes both wrapped words and split numbers;
  confirm the boundary assertions fail if the `^###\s` reset is removed.

### S4 — Require a base ref and fail when the commit range is empty

- Kind: behavioral
- Budget: 80 changed lines
- Files: `scripts/slice-pack.mjs` (modify) — make `--base` required:
  `const base = value('--base')`; if absent, print the usage line (with
  `--base <ref>` no longer bracketed) and `process.exit(2)` before reading the
  plan. Keep `--head` defaulting to `HEAD` and `--context` to `10`. After
  `collectSlices`, if `entries.length === 0`, print
  `no slice commits in <base>..<head>` and `process.exit(1)` before
  `mkdirSync`/any write.
  `scripts/slice-pack.test.ts` (modify) — add a CLI `describe` using
  `spawnSync(process.execPath, [script, ...args], { cwd: repoRoot, encoding:
  'utf8' })`, and `mkdtempSync(join(tmpdir(), 'slice-pack-'))` for the plan/out
  paths. Case 1: no `--base` → status 2, stderr contains `--base`, no
  `INDEX.md` written. Case 2: `--base HEAD --head HEAD` → status 1, stderr
  contains `no slice commits`, no `INDEX.md` written. The plan fixture is a
  two-line `## Slices` document written into the temp dir.
- Tests: `scripts/slice-pack.test.ts` — CLI guard cases above.
- Covers: R1-N2, AC1
- Commit: `fix(#74): R1-N2 require --base and reject empty ranges`
- Reviewer note: the empty-range check must happen before any output write, so a
  bad invocation cannot leave a fresh empty index.

### S5 — Refresh generated packets and always write the skipped note

- Kind: behavioral
- Budget: 100 changed lines
- Files: `scripts/slice-pack.mjs` (modify) — extract the write phase of `main`
  (355–361) into an exported `writeOutput(out, entries)`: `mkdirSync`, unlink
  any existing `INDEX.md`, `_skipped.md`, and files matching `/^S[^/]*\.md$/`
  in `out`, then write the currently reviewed packets, `renderIndex(entries)`,
  and `renderSkipped(skipped)` **unconditionally** (empty list included).
  `main` computes `entries` and calls `writeOutput`. Do not delete unrelated
  files in `out`.
  `scripts/slice-pack.test.ts` (modify) — one case: create a temp dir with
  stale `S9.md` and a `_skipped.md` containing `stale`; call
  `writeOutput(dir, [])`; assert `S9.md` is gone, `_skipped.md` exists and
  does not contain `stale`, and `INDEX.md` exists.
- Tests: `scripts/slice-pack.test.ts` — output-refresh case above.
- Covers: R1-N4, AC1
- Commit: `fix(#74): R1-N4 refresh generated slice packets`
- Reviewer note: cleanup targets only generated names; a re-run cannot feed the
  integrator a stale skip list.

### S6 — Name the task inputs last in the slice-reviewer prompt

- Kind: mechanical
- Budget: 25 changed lines
- Files: `.opencode/agent/slice-reviewer.md` (modify) — append a final
  `## Inputs` section after `## Output` (currently ends at line 78) listing the
  task-supplied fields: slice id, commit, plan entry, script checks, diff, and
  the output JSON path **last**. Keep the static checklist first; state that the
  output path is where the JSON in `## Output` is written. No behavior change.
- Tests: none (configuration prompt).
- Covers: R1-N3, AC2
- Commit: `docs(#74): R1-N3 list slice reviewer inputs`
- Reviewer note: this restores the plan's "static content first, dynamic inputs
  last" ordering without adding a second source of instructions.

### S7 — Deduplicate priority labels and correct the index parameter type

- Kind: behavioral
- Budget: 30 changed lines
- Files: `scripts/slice-pack.mjs` (modify) — in `decide` (146–157), dedupe the
  labels before joining (`[...new Set(hits.map((hit) => hit.label))]`) so two
  engine files render `priority path: engine`, not `engine, engine`. Fix the
  `renderIndex` JSDoc (211–217) to
  `(ReturnType<typeof collectSlices>[number] & { decision: { review: boolean,
  reason: string }, packet?: boolean })[]` so the intersection applies to the
  element, not the array.
  `scripts/slice-pack.test.ts` (modify) — in the priority case, pass two engine
  paths and assert `reason === 'priority path: engine'`.
- Tests: `scripts/slice-pack.test.ts` — deduped reason assertion.
- Covers: R1-N5, R1-N7, AC3
- Commit: `fix(#74): R1-N7 deduplicate priority labels`
- Reviewer note: dedupe changes only the reason text; the packet's priority
  line still lists every triggering path.

## Coverage

- **AC1** — S3 fixes what the parser feeds the packet; S4 prevents an empty
  index; S5 guarantees a re-run replaces stale packets. Proved by the parser
  cases (S3) and the CLI/output cases (S4, S5), plus a manual packer run in
  Verification.
- **AC2** — S6 restores the documented input order; the prompt remains
  packet-only. Proved by reading `.opencode/agent/slice-reviewer.md`; the
  prose test that used to assert this is removed under AC6.
- **AC3** — S7 keeps the priority reason readable; the decision logic itself is
  unchanged from round 1. Proved by the `decide` cases in S2 and the deduped
  reason assertion in S7.
- **AC4** — Satisfied in round 1; no round-2 slice changes permissions. S1
  removes the prose test that used to assert the permission frontmatter.
  Verified with `opencode debug agents` (unchanged).
- **AC5** — Satisfied in round 1; no round-2 slice changes integrate mode.
- **AC6** — S1 deletes the configuration-prose file; S2 deletes the rendered
  output and trivial-mapping cases. Proved by `rg -n "readFileSync|opencode"
  scripts/*.test.ts` returning no `.opencode/` read and by the reduced case
  list.
- **AC7** — S2 keeps parser/decision tests; S3, S4, S5, and S7 add only
  behavior tests. Proved by `npm run test` and the per-slice `slice-check`
  runs.

## Verification

Per slice, run:

```bash
node scripts/slice-check.mjs --budget <slice budget>
```

It runs `npm run check` → `lint` → `format` → `test`, stages the slice, and
exits 2 if the slice exceeds 1.25× its budget. Budgets: S1 60, S2 130, S3 90,
S4 80, S5 100, S6 25, S7 30.

After S5, exercise the packer against the round-1 range and then re-run it into
the same directory:

```bash
node scripts/slice-pack.mjs --plan .ai/74-try-to-make-slice-reviewing-more-economical/round-1/plan.md --base main --head 70bb2a4 --out /tmp/opencode/74-r2-pack
node scripts/slice-pack.mjs --plan .ai/74-try-to-make-slice-reviewing-more-economical/round-1/plan.md --base 70bb2a4 --head 70bb2a4 --out /tmp/opencode/74-r2-pack
```

The first run writes packets and `_skipped.md`; the second exits 1 with
`no slice commits` and leaves the first run's files untouched (the guard runs
before `writeOutput`). Then run `--base 45758ab~1 --head 45758ab` to confirm
stale `S*.md` files are removed.

Per round, before pushing, run `npm run test` once more. There is no
`## Smoke steps` section and no `npm run e2e`: this issue changes review tooling
only, not user-visible app behavior. No version bump: CONVENTIONS.md says later
review rounds on the same issue do not bump again (`package.json` is already
`1.7.0`).

## Edge cases and risks

- **Revision size:** the estimate is 440 changed lines, above the 400-line
  revision target; revision rounds are exempt from the gate but each slice
  stays inside its own budget.
- **Lost prose guard:** deleting `review-workflow.test.ts` means nothing
  mechanically checks that the agent prompts keep the packet-only rules. This
  is the human's explicit requirement; `opencode debug agents` and review
  remains the check.
- **Continuation rule:** dropping a trailing hyphen is correct for soft-wrapped
  plan fields. A genuine hyphenated word at a line break (`data-` / `dependent`)
  would become `datadependent`; plan bullets do not wrap that way today. The
  test fixture pins the two observed failure shapes (wrapped kind, split
  budget).
- **CLI tests spawn git:** the S4 cases run the script in the repo root so
  `HEAD..HEAD` is a real empty range. They do not depend on branch names or
  network.
- **Output cleanup:** only `INDEX.md`, `_skipped.md`, and `S*.md` in the packet
  directory are removed. A failed run before `writeOutput` leaves the previous
  output intact.
- **Mechanical test deletions:** S1 and S2 are pure deletions with no production
  change; `slice-check` still runs the full gate and counts the deleted lines.
- **No `.opencode` test:** after S1, no test reads agent or command markdown;
  prompt changes are reviewed as configuration.

## Findings and actions

- **R1-N1** — Wrapped `Kind`/`Budget` continuations are mangled. S3 tracks the
  active field for every bullet and joins continuations with the hyphen rule.
- **R1-N2** — `--base` defaults to `HEAD` and writes an empty index. S4 requires
  `--base` (exit 2) and rejects an empty range (exit 1) before writing.
- **R1-N3** — `slice-reviewer.md` lacks `## Inputs`. S6 appends it last, after
  `## Output`, with the output JSON path last.
- **R1-N4** — `_skipped.md` and stale packets survive a re-run. S5 clears only
  generated files and always writes `_skipped.md`.
- **R1-N5** — `renderIndex` JSDoc intersects the array. S7 fixes the element
  type.
- **R1-N6** — Heading-boundary test cannot fail. S3 asserts S2's kind and entry
  do not absorb the later heading.
- **R1-N7** — Priority reason repeats a label per file. S7 dedupes labels and
  asserts the reason.

## Out of scope

- App, engine, strategy, schedule, store, UI, and e2e tests.
- Changing permission frontmatter, the review command, or integrator behavior.
- New packet features, review-scope rules, or changes to
  `scripts/slice-check.mjs` / `scripts/review-pack.mjs`.
- Version bump or release metadata.

## Open blocking questions

None.
