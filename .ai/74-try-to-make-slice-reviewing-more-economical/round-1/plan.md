- Round: 1
- Addresses: none (initial plan)
- Slices: 8
- Estimated size: 977 changed lines

# Issue #74 — Try to make slice reviewing more economical

## Goal and acceptance criteria

Make each review round cheaper by moving fixed work into scripts, giving every
slice reviewer a self-contained packet and no tools, narrowing the per-slice
job, skipping tiny low-risk slices, and making the integrator verify only
blockers and high-confidence findings.

- **AC1:** `scripts/slice-pack.mjs` writes one self-contained packet per slice
  commit containing the plan entry (idea and reviewer note), the applicable
  review focus, script-computed facts, and the commit diff with 10 lines of
  context. A slice reviewer can complete its review in one model call without
  reading files or running commands.
- **AC2:** Per-slice review judges only correctness and test adequacy. It
  reports at most 3 findings ranked by severity, makes no reproduction
  attempts, and leaves budget, kind, and tests-in-slice checks to the packet's
  script facts.
- **AC3:** A slice with fewer than 60 changed lines is skipped unless it
  touches a review-priority path. Mechanical slices are skipped unless they
  touch one. All skipped slices are reviewed together in the integrator's
  pass.
- **AC4:** The three review subagents expose only the tools they need:
  `slice-reviewer` and `plan-writer` are write-only to their artifact, and
  `reviewer` has no web, subagent, or MCP tools.
- **AC5:** In per-slice mode the integrator verifies only blockers and
  high-confidence findings. It reproduces only the blockers it keeps and does
  not re-verify every candidate.

## Slices

### S1 — Expose only the tools each review subagent actually uses

- Kind: behavioral
- Budget: 200 changed lines
- Files: `.opencode/agent/slice-reviewer.md` (modify) — replace the legacy
  `permission:` block with native V2 `permissions:`: first
  `{ action: '*', resource: '*', effect: deny }`, then one allow,
  `{ action: edit, resource: '.ai/**/round-*/slices/*.json', effect: allow }`.
  `.opencode/agent/plan-writer.md` (modify) — same deny-all pattern, then
  `{ action: edit, resource: '.ai/**/round-*/plan.md', effect: allow }`.
  `.opencode/agent/reviewer.md` (modify) — replace `permission:` with
  `permissions:`: deny `*/*`; allow `read`, `glob`, and `grep` on `**`; allow
  `edit` on `.ai/**` and `**/.ai/**`; allow `external_directory` on
  `/tmp/opencode/**`; allow `shell` on `*`; then translate every existing
  `bash:` deny pattern (lines 16–61) one-for-one to
  `{ action: shell, resource: '<pattern>', effect: deny }`. No allow survives
  for `webfetch`, `websearch`, `subagent`, or any MCP tool.
- Tests: none (configuration). Verify with `opencode debug agents` and confirm
  each of the three agents has its own `*/* deny` rule before its allows.
- Covers: AC4
- Commit: `feat(#74): expose only the tools review subagents use`
- Reviewer note: last matching rule wins. Confirm the deny-all is first in each
  agent's own block, the write-only agents have exactly one allow, and
  `reviewer` still has its shell deny list after the shell allow.

### S2 — Index plan slices against the commits that implement them

- Kind: behavioral
- Budget: 250 changed lines
- Files: `scripts/slice-pack.mjs` (create) — no dependencies; export
  `parsePlanSlices(markdown)` returning
  `[{ id, idea, kind, budget, files, tests, reviewerNote, entry }]` where
  `entry` is the verbatim `### S<k>` block. Parse only inside the `## Slices`
  section: headings `/^### (S\d+[a-z]?) — (.+)$/`, bullets
  `/^- (Kind|Budget|Files|Tests|Covers|Commit|Reviewer note): (.*)$/`, and
  indented continuation lines joined with one space. Export
  `planIdFor(sliceId)` (`S10b` → `S10`, `report` → `null`),
  `PRIORITY_PATHS` (`src/lib/{engine,strategies,schedules,embeddings,tokenizers,workers}/`
  and `src/lib/stores/`, each with a short label), `priorityFor(paths)`
  returning `{ path, label }[]`, `decide({ kind, total, paths })` returning
  `{ review, reason }`, `collectSlices({ base, head })` returning
  `{ sha, short, subject, slice, kind, added, removed, total, paths }[]` from
  `git log --reverse` trailers, and `renderIndex(entries)`.
  `collectSlices` skips records with no `Slice` trailer and `Slice: report`,
  and excludes `.ai/`, `package-lock.json`, and binary files from numstat.
  `decide` order: priority hit → review; mechanical → skip; `total < 60` →
  skip; otherwise review. The CLI accepts
  `--plan <path> --base <ref> --head <ref> --out <dir> --context <n>` (defaults
  `HEAD` and 10), writes `INDEX.md`, and guards `main()` with
  `pathToFileURL(process.argv[1]).href === import.meta.url`.
  `scripts/slice-pack.test.ts` (create) — parser with a wrapped reviewer note,
  `planIdFor`, `priorityFor`, `decide` at 59/60 lines and for mechanical,
  priority, and non-priority slices, and `renderIndex` lines.
  `vite.config.ts` (modify) — test include becomes
  `['src/**/*.test.ts', 'scripts/**/*.test.ts']`.
- Tests: `scripts/slice-pack.test.ts` — cases above.
- Covers: AC1, AC3
- Commit: `feat(#74): index slice commits against their plan entries`
- Reviewer note: the parser must stop at the next `##`/`###` heading and must
  not mistake `### Coverage` for a slice. Check the `decide` precedence:
  priority beats mechanical, mechanical beats the 60-line rule.

### S3 — Render one self-contained review packet per slice

- Kind: behavioral
- Budget: 190 changed lines
- Files: `scripts/slice-pack.mjs` (modify) — add
  `diffFor(sha, context)` (`git show --format= --no-renames -U<context> <sha>`),
  `renderPacket(entry)`, and `renderSkipped(entries)`. `main` writes
  `<out>/S<k>.md` for reviewed slices, `<out>/_skipped.md` when at least one
  slice is skipped, and appends `→ \`S<k>.md\`` to reviewed `INDEX.md` lines.
  Packet order: title, facts bullets, `## Plan entry` (verbatim), `## Script
  checks`, `## Diff (-U10)`. Facts: commit and subject, kind versus plan kind,
  `+added/-removed = total` versus budget, test paths in the commit, `Review
  focus: correctness; test adequacy`, priority labels and triggering paths,
  and the decision. Script checks render `PASS` or `CHECK` for kind match,
  budget, and tests-in-slice. Enclose diffs in a five-backtick fence so agent
  markdown inside a diff cannot close it.
  `scripts/slice-pack.test.ts` (modify) — a rendered packet contains the
  verbatim plan entry, reviewer note, five-backtick fence, and diff text; a
  `_skipped.md` contains every skipped slice and its reason.
- Tests: `scripts/slice-pack.test.ts` — rendering cases above.
- Covers: AC1, AC3
- Commit: `feat(#74): render self-contained slice review packets`
- Reviewer note: a reviewer with no tools must be able to decide from the
  packet alone. Confirm the diff is the commit only, not the cumulative range,
  and that script checks report rather than silently enforce.

### S4 — Narrow slice review to correctness and test adequacy

- Kind: behavioral
- Budget: 180 changed lines
- Files: `.opencode/agent/slice-reviewer.md` (modify) — rewrite the body so
  the packet is the only input: state "The packet is complete. Do not read
  files, run commands, or explore." Limit judgement to correctness of changed
  lines and test adequacy. State "At most 3 findings", "Do not attempt to
  reproduce findings", and remove the `repro` field from the JSON example.
  Keep the summary, `testGaps`, severity, confidence, and line-citation rules.
  Order the body static checklist first and `## Inputs` last. Add `steps: 3`
  to the frontmatter so one write plus the summary is the normal path.
  `scripts/review-workflow.test.ts` (create) — read the agent file and assert:
  `permissions:` present, no `\npermission:`, an `action: '*'` deny, the
  string `At most 3 findings`, no `"repro"` field, and no instruction to read
  or run.
- Tests: `scripts/review-workflow.test.ts` — contract cases above.
- Covers: AC1, AC2, AC4
- Commit: `feat(#74): narrow slice review to correctness and tests`
- Reviewer note: the whole economy comes from this prompt admitting the packet
  is sufficient. Confirm no sentence sends the reviewer back to the repo and
  that the output path is the last dynamic input.

### S5 — Drive `/review` from packets and skip small low-risk slices

- Kind: behavioral
- Budget: 150 changed lines
- Files: `.opencode/command/review.md` (modify) — in per-slice mode, after
  `mkdir -p`, run
  `node scripts/slice-pack.mjs --plan ".ai/<issue-number>-<slug>/round-N/plan.md" --base "$BASE" --head "$REVIEWED" --out ".ai/<issue-number>-<slug>/round-N/slices"`,
  then read `slices/INDEX.md`. Delegate one `slice-reviewer` per `review`
  line, at most 6 in parallel; read the packet file yourself and pass its
  content inline. The subagent prompt must be a fixed first line identical for
  every call, then `PACKET`, then the packet, then `OUTPUT` and the JSON path
  last. Do not pass a path for the reviewer to open. Delete the manual
  mechanical-skip rule and the instruction to pass the plan slice entry.
  Pass `slices/_skipped.md` to the integrator alongside the slice JSON paths.
  `scripts/review-workflow.test.ts` (modify) — assert the command mentions
  `scripts/slice-pack.mjs`, `_skipped.md`, and inline packet delivery.
- Tests: `scripts/review-workflow.test.ts` — command contract cases above.
- Covers: AC1, AC2, AC3, AC4
- Commit: `feat(#74): drive slice reviews from pre-built packets`
- Reviewer note: the command must never tell the reviewer to open a file or
  run a command. Check the fixed preamble comes before the packet and the
  output path comes last, so the cacheable prefix is identical across slices.

### S6 — Verify only blockers and high-confidence findings

- Kind: behavioral
- Budget: 130 changed lines
- Files: `.opencode/agent/reviewer.md` (modify) — add `INDEX.md` and
  `_skipped.md` to Inputs. In integrate mode, replace "verify each candidate"
  with: verify every blocker and every high-confidence finding at the cited
  lines; skim low-confidence findings and keep only those confirmed by the
  cited lines. Reproduce only the blockers kept; an unreproduced candidate is
  at most a concern. Add one pass over `_skipped.md` for skipped slices. In
  "What to review", drop the budget, kind, and tests-in-slice questions and
  state that the packet's Script checks already reports them. Keep cross-slice
  plan conformance, scope checks, conventions, and performance review.
  `scripts/review-workflow.test.ts` (modify) — assert the reviewer text
  contains `high-confidence`, `Reproduce only the blockers`, and `_skipped.md`.
- Tests: `scripts/review-workflow.test.ts` — integrator contract cases above.
- Covers: AC2, AC3, AC5
- Commit: `feat(#74): verify only blockers and high-confidence findings`
- Reviewer note: the integrator still owns cross-slice scope and plan
  conformance; only slice-interior verification narrows. Check that skipped
  slices are judged in one pass, not re-delegated.

### S7 — Document packet-based slice review

- Kind: mechanical
- Budget: 90 changed lines
- Files: `AGENTS.md` (modify) — in the review workflow paragraph, state that
  `/review` builds one packet per slice with `scripts/slice-pack.mjs`, that
  slices under 60 lines without a priority path are reviewed in the integrator
  pass, and that the integrator verifies only blockers and high-confidence
  findings. `.ai/README.md` (modify) — add `slices/INDEX.md`, `slices/S<k>.md`,
  and `slices/_skipped.md` to the gitignored layout and describe the packet
  flow, the 60-line skip rule, and the integrator's narrowed verification.
- Tests: none (documentation).
- Covers: AC1, AC2, AC3, AC4, AC5 (documentation)
- Commit: `docs(#74): document packet-based slice review`
- Reviewer note: every filename and flag in the docs must match the script and
  command as implemented; no aspirational behavior.

### S8 — Bump the version

- Kind: mechanical
- Budget: 5 changed lines
- Files: `package.json` (modify) — version `1.6.1` → `1.7.0` (`feat` is the
  highest commit type in this issue).
- Tests: none.
- Covers: none (release hygiene).
- Commit: `chore(#74): bump version to 1.7.0`
- Reviewer note: confirm the bump is minor, not patch, and that no other
  package metadata changed.

## Coverage

- **AC1** — S2 builds the index, S3 renders packets, S5 delivers them inline.
  Proved by `scripts/slice-pack.test.ts` (parser, packet contents, fence) and
  a local run that writes `INDEX.md`, `S<k>.md`, and `_skipped.md`.
- **AC2** — S4 narrows the slice reviewer, S5 keeps its input packet-only, S6
  limits repro to kept blockers. Proved by `scripts/review-workflow.test.ts`
  assertions on the prompt contract.
- **AC3** — S2's `decide()` and S3's `_skipped.md` implement the rule; S5
  consumes `INDEX.md` instead of making the command decide. Proved by the
  `decide()` cases at 59/60 lines, mechanical, priority, and non-priority.
- **AC4** — S1's native `permissions` blocks remove web, subagent, and MCP
  tools. Proved by `opencode debug agents` showing the deny-all rule in each
  agent and by the frontmatter assertions in `scripts/review-workflow.test.ts`.
- **AC5** — S6 narrows integrate mode. Proved by the `high-confidence` and
  `Reproduce only the blockers` assertions in `scripts/review-workflow.test.ts`.

## Verification

Per slice, run:

```bash
node scripts/slice-check.mjs --budget <slice budget>
```

It runs `npm run check` → `lint` → `format` → `test`, stages the slice, and
exits 2 if the slice exceeds 1.25× its budget. Split an over-budget slice into
`S<k>a`, `S<k>b`, … rather than dropping tests.

For S1, also run and inspect:

```bash
opencode debug agents
```

Confirm the merged permission list for `slice-reviewer`, `plan-writer`, and
`reviewer` shows the intended deny-all and only the intended allows.

Per round, before pushing, run `npm run test` once more and `npm run build`
(CI runs the build and this issue changes `vite.config.ts` test discovery).
There is no `## Smoke steps` section and no `npm run e2e` run: this issue
changes agent tooling only, not user-visible app behavior.

## Edge cases and risks

- **Parser strictness:** `slice-pack.mjs` depends on the plan's `### S<k> —`
  heading and the `Slice:`/`Kind:` trailers. A missing plan entry for a commit
  exits 1 with the slice id; a commit with no `Slice:` trailer or
  `Slice: report` is ignored.
- **Split slices:** commits `S<k>a`, `S<k>b` map to plan entry `S<k>`. Each
  commit gets its own packet and shares the plan entry and reviewer note.
- **Threshold:** 60 changed lines means insertions plus deletions, excluding
  `.ai/`, lockfiles, and binaries, matching `slice-check.mjs` and
  `review-pack.mjs`. Priority paths are the engine, strategies, schedules,
  embeddings, tokenizers, workers, and stores directories; adjust that list in
  one place if the team wants different hot paths.
- **Tool exposure:** `opencode debug agents` verifies merged permissions, but
  there is no non-interactive test of which tools a model actually calls. The
  `steps: 3` cap is the runtime backstop for the slice reviewer.
- **Prose contract tests:** `scripts/review-workflow.test.ts` asserts phrases
  the workflow depends on. It is intentionally narrow and will fail on a
  wording change that removes a rule; update the test with the rule.
- **Script tests:** `svelte-check` does not typecheck `scripts/`, so the new
  tests are exercised by Vitest only. `vite.config.ts` must include
  `scripts/**/*.test.ts` or the tests silently do not run.
- **No MCP servers are configured today** (`opencode mcp list` reports none).
  The deny-all rule keeps the subagents MCP-free if a server is added later.
- **Reviewer tools:** `reviewer` keeps `read`, `glob`, `grep`, `shell`, and
  `edit`; only web, subagent, and MCP tools are removed. This is deliberate:
  the integrator still needs `git show`, gates, and the review packer.
- **Size:** the round estimate is 977 changed lines, under the 1200-line gate,
  so no `large` token is needed.

## Out of scope

- App code, strategies, schedules, workers, UI, and Playwright specs.
- Migrating `build`, `plan`, `explore`, or other agents to native V2
  permissions.
- Changing `.gitignore`; `.ai/**/round-*/slices/` is already ignored.
- Changing `scripts/slice-check.mjs` or `scripts/review-pack.mjs`.
- Automated enforcement of budget, kind, or tests-in-slice beyond the packet's
  reported facts.

## Open blocking questions

None.
