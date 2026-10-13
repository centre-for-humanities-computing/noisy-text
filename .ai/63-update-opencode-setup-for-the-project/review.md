# Review: Issue #63 — Update opencode setup for the project

- Branch: `63-update-opencode-setup-for-the-project` (HEAD `56811db`, parent
  `d5a1b03`)
- Scope: commit `56811db` only. `git diff main...HEAD` also contains #62/#65
  because `main` is behind; those are out of scope for this issue.
- Artifacts: `.ai/63-update-opencode-setup-for-the-project/plan.md`,
  `diff-report.md`

## Verdict

`block` — one CI-failing blocker (unformatted committed artifact). Everything
else is minor. The substantive deliverables (`AGENTS.md`, `opencode.json`,
`.opencode/agent/reviewer.md`, `.opencode/command/*.md`, `.ai/README.md`, doc
edits) match the plan and resolve correctly under `opencode debug agent`.

## Blockers

### B1 — Committed `diff-report.md` fails `npx prettier --check .` (CI lint job)

- Where: `.ai/63-update-opencode-setup-for-the-project/diff-report.md` (whole
  file; table rows at lines 9–44).
- What is wrong: the file is not Prettier-formatted. `.prettierignore` does
  not exclude `.ai/`, and CI runs `npx prettier --check .`
  (`.github/workflows/ci.yml:20`), so the committed file fails CI.
  `.opencode/package.json` also warns, but it is gitignored via
  `.opencode/.gitignore` and absent in CI, so it is not a CI failure — it
  still makes the report's own "all files formatted" claim false locally.
  That claim (diff-report.md:41) was checked before the report existed.
- Why it matters: the PR cannot pass CI as committed; the verification table
  does not describe the committed tree.
- Concrete fix: `npx prettier --write
  .ai/63-update-opencode-setup-for-the-project/diff-report.md`, re-run
  `npx prettier --check .`, then amend/commit. Also fix the workflow ordering
  (see N2) so this does not recur.

## Non-blocking concerns

### N1 — `/review` command deviates from the approved plan (`agent: plan` vs `agent: build`)

- Where: `.opencode/command/review.md:3`; plan `.ai/.../plan.md:98`.
- The plan specifies `agent: build`; the implementation uses `agent: plan`,
  and the diff report does not mention the change. Arguably safer (the `plan`
  agent's edit permission is restricted to `.ai/**`, so `/review` cannot touch
  source), but it couples `/review`'s ability to write `review.md` to the
  `.ai/**` edit-permission override — the mechanism the plan flags as risky
  (plan.md:166–169). Either revert to `agent: build` or document the
  intentional change.

### N2 — Workflow writes `.ai/` artifacts after the format step, so they are never formatted

- Where: `.opencode/command/implement.md:16-17` (format) vs `:18-20` (write
  `diff-report.md`); `.opencode/command/review.md:14` (write `review.md`).
- `/implement` runs `npm run format` before writing `diff-report.md`; `/review`
  writes `review.md` after its checks. Since `.ai/` is not Prettier-ignored,
  every generated artifact fails `prettier --check` unless formatted
  afterward. Root cause of B1; will recur for `review.md`. Fix: add a final
  `npx prettier --write .ai/` or reorder. (Alternatively ignore `.ai/`, which
  conflicts with the plan's "committed, human-readable" intent, so prefer
  formatting.)

### N3 — Broken single-test example in `AGENTS.md`

- Where: `AGENTS.md:32`.
- `npx vitest run -t "cache key"` matches zero tests (26 files / 334 skipped).
  The only "cache key" occurrence is a comment in
  `src/lib/stores/graph-store.test.ts:37`. Use a real name, e.g.
  `-t "is deterministic for the same seed"`
  (`src/lib/engine/trajectory.test.ts:94`).

### N4 — New `console` rule not backed by `CONVENTIONS.md` or the plan

- Where: `AGENTS.md:65`.
- "`console` only via `warn`/`error`" appears only in `AGENTS.md`; it is not
  in `CONVENTIONS.md` and was not in the plan's AGENTS.md section list
  (plan.md:112–119). The codebase currently has zero `console.*` calls. Add
  the rule to `CONVENTIONS.md` or drop it to avoid a second source of truth.

### N5 — Stale registry path in `CONVENTIONS.md`

- Where: `CONVENTIONS.md:46`.
- Says strategies are registered in `src/lib/strategies/index.ts`; actual
  registration is `registry.ts` (`index.ts` only re-exports). `AGENTS.md:55`
  and `src/lib/strategies/README.md:7,11` are correct. Pre-existing drift the
  doc cleanup missed.

### N6 — Stale diff-report status line

- Where: `diff-report.md:50`.
- "Not yet committed/pushed; PR not created (awaiting human go-ahead)" is
  false: commit `56811db` exists and the branch is ahead of origin by 1.
  Update or drop the line.

### N7 — Version bump type vs commit type

- Where: `package.json:3` (1.1.0 → 1.2.0), commit `chore(#63)`.
- The plan explicitly chose `1.2.0` (plan.md:149), so this is
  plan-conformant, but a `chore` commit bumping the minor version is
  semver-odd. Flagged for awareness only; not a required change.

## Missing tests and verification gaps

- No end-to-end check that the `plan` agent's `.ai/**` edit permission
  actually matches at runtime; the plan itself lists this as a risk
  (plan.md:166–169). `opencode debug agent plan` confirms the patterns are
  applied (`.ai/**`, `**/.ai/**` alongside the built-in
  `.opencode/plans/*.md`), but no smoke test proves a relative
  `.ai/.../plan.md` write is allowed and a write outside `.ai/` is denied.
- No check that `/review` can write `review.md` under `agent: plan` (see N1);
  this review's own output was the first test of that path.
- The verification table does not cover the artifacts it describes:
  `diff-report.md` and `review.md` are produced after the verification
  sequence, so the reported `prettier --check` result is not valid for the
  committed tree. Add a final format+check after artifact generation (N2).

## Open questions for the author

1. Was `/review` intentionally switched to `agent: plan`? If yes, update
   plan.md/diff-report.md; if no, revert to `agent: build`.
2. Should `.ai/` be Prettier-ignored, or should the commands format artifacts
   after writing? (Recommended the latter.)
3. Is the `console` rule intended as a project convention (then add to
   `CONVENTIONS.md`), or was it copied in by mistake?

## Flagged files

- `.ai/63-update-opencode-setup-for-the-project/diff-report.md` (lines 9–44,
  41, 50) — B1 (prettier/CI), N6 (stale status).
- `.opencode/command/review.md:3` — N1 (agent deviation).
- `.opencode/command/implement.md:16–20` — N2 (format before artifact write).
- `AGENTS.md:32,65` — N3 (broken test example), N4 (unbacked console rule).
- `CONVENTIONS.md:46` — N5 (stale `index.ts` registry path).
- `package.json:3` — N7 (minor bump on `chore`).

## Verification performed

- `npm run check` — 0 errors, 0 warnings (matches the diff report).
- `npm run lint` — passed.
- `npm run test` — 26 files / 334 tests passed (matches the diff report).
- `npm run build` — built and wrote the static site (matches the diff
  report).
- `npx prettier --check .` — fails on `.ai/63-.../diff-report.md` (B1).
- `opencode debug agent plan|explore|reviewer` — config resolves as intended
  (edit patterns, models, bash allowlist).
- `npx vitest run -t "cache key"` — 0 tests matched (N3).
- `grep GLOSSARY|copilot-instructions` — no live references outside this
  issue's `.ai/` files.
