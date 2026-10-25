- Round: 2
- Addresses: R1-B1, R1-N1, R1-N2, R1-N3, R1-N4, R1-N5, R1-N6, R1-N7, R1-N8; new requirements
- Slices: 10
- Estimated size: 230 changed lines

# Issue #77 — Round 2: fix round-1 review findings and settle the $K_{\text{eff}}$ contract

## Goal and acceptance criteria

Round 1 implemented hosted word-vocabulary loading and word-level tokenization. Its
review verdict was `block` with nine open findings. This round fixes the blocker,
resolves each non-blocking finding, and makes the effective-vocabulary contract
explicit in code, copy, docs and tests. No unrelated changes.

Acceptance criteria (from issue #77):

- AC1 — The default prose round-trips; OOV words pass through unchanged and are
  labelled in prose, chips and graph.
- AC2 — `uniform` and `absorbing` scrub over word tokens; masks equal
  $K_{\text{eff}}$ and never collide with OOV ids; `[MASK]` renders.
- AC3 — A fresh browser with no IndexedDB loads the hosted vocabulary; reload hits
  the IDB cache.
- AC4 — Editing text changes $K_{\text{eff}}$ without stale trajectories,
  mislabelled masks or cache collisions.
- AC5 — `check`, `lint`, `format`, `test` and `npm run e2e` pass.

## New requirements

Human-authored requirements block, quoted verbatim:

```text
- Keep trailer blocks contiguous in furture commits to avoid them being skipped.
- The commit is pushed now.
- Do not update the diff report but be aware that the 50 word json is live now
- For K_eff go with the most reasonable choice or explain the issue to me in more detail if I need to make a decision.
```

Folded into this round:

- **NR1 — contiguous trailers.** Every commit in this round ends with the trailer
  block on consecutive lines, no blank line between them:
  `Slice: S<k>/10` immediately followed by `Kind: behavioral|mechanical`.
  Verification includes `git log -1 --format='%(trailers)'` showing both trailers.
- **NR2 — commit is pushed.** Round 1's final commit `bea4f8d` is now on the remote.
  This round pushes each slice and verifies that PR #81's checks run on the new
  head. No history rewrite.
- **NR3 — diff report and hosted asset frozen.** Do not edit
  `.ai/.../round-1/diff-report.md`, do not re-run the export/upload, and do not
  change `HF_DATASET_REVISION`. The hosted `word-vocab-50k.json` (sha `ee6442d`,
  50,000 words) is live and remains the pinned asset. The 40-word e2e fixture is
  unchanged.
- **NR4 — $K_{\text{eff}}$ decision.** Chosen contract: $K_{\text{eff}} = K +
  |\text{OOV table}|$, where the table is per tokenizer **instance**, append-only
  in first-seen order. Rationale: ids are allocated from that table, so the mask
  sentinel must exceed every id ever assigned on the instance. A per-input distinct
  count is unsafe as a sentinel: if an earlier input assigned `' '` → id $K$, the
  next input with one new OOV token receives id $K+1$, which would equal a
  per-input sentinel of $K+1$. The instance table also matches the cache-key
  requirement (growth changes $K_{\text{eff}}$ without changing ids). The status
  line therefore reports the instance table and says “seen”; docs reserve “per
  input” for the encoded result only. S3 and S4 implement this; the human
  confirmed the choice in round 2.

## Slices

### S1 — Restore the prettier-clean pinned revision line

- Kind: mechanical
- Budget: ≤4 changed lines
- Files: `src/lib/embeddings/loader.ts` (modify) — add the missing trailing
  semicolon to `HF_DATASET_REVISION` at line 30; no value change.
- Tests: none (formatting only); verified by `npx prettier --check .`.
- Covers: AC5, R1-N1
- Commit: `fix(#77): R2-N1 restore prettier formatting for the pinned revision`
- Reviewer note: Confirm the sha value is byte-identical to round 1 and only the
  semicolon changed.

### S2 — Forward the OOV table into the union-graph worker message

- Kind: behavioral
- Budget: ≤60 changed lines
- Files: `src/lib/stores/graph.svelte.ts` (modify) — in `_start`, add
  `oovTokens: opts.oovTokens` to the `TrajectoryWorkerUnionGraphRequest` literal
  (`:115-128`). `UnionGraphRequestOpts` already inherits the optional field from
  the protocol, so no type change.
- Tests: `src/lib/stores/graph-store.test.ts` (modify) — add a case that requests a
  graph with `oovTokens: [' ', 'zorblax']` and asserts the posted message contains
  exactly that table (deep equality), plus the existing fields. Keep the existing
  fake `postUnionGraph` pattern. `src/lib/workers/token-label.test.ts` already
  proves an OOV id decodes to its word rather than `#id`; no change needed there.
- Covers: AC1, R1-B1
- Commit: `fix(#77): R2-B1 forward OOV labels to the union graph`
- Reviewer note: The page already passes `oovTokens` (`+page.svelte:106`) and the
  worker already consumes `msg.oovTokens` (`trajectory.worker.ts:620`); this slice
  closes the only gap in that chain. The regression test must fail before the fix.

### S3 — Label the status OOV count as the instance table (“seen”)

- Kind: behavioral
- Budget: ≤25 changed lines
- Files: `src/routes/+page.svelte` (modify) — in `statusText`, change
  `oovPart` from ` (+${encoded.vocabSize - t.vocabSize} OOV)` to
  ` (+${encoded.vocabSize - t.vocabSize} OOV seen)`. `encoded.vocabSize` is
  already $K_{\text{eff}}$; the delta is the instance table size. No logic change.
- Tests: `e2e/word-tokenizer.spec.ts` (modify) — update the three assertions at
  `:49`, `:92`, `:107` to `(+2 OOV seen)` / `(+3 OOV seen)`; add a comment at the
  second edit that its input has two distinct OOV tokens while the table has three,
  so `+3` pins the instance-table contract rather than a per-input count.
- Covers: AC2, AC4, R1-N2, NR4
- Commit: `fix(#77): R2-N2 label the status OOV count as seen`
- Reviewer note: The number and $K_{\text{eff}}$ are unchanged; only the label and
  test expectations change. Confirm the comment makes the cumulative semantics
  obvious and that no per-input counter was introduced.

### S4 — Describe OOV ids as per-instance in docs and picker copy

- Kind: mechanical
- Budget: ≤30 changed lines
- Files:
  - `AGENT_CONTEXT.md:63-66` (modify) — say the word tokenizer keeps a
    per-instance, append-only OOV table in first-seen order and
    $K_{\text{eff}} = K + |\text{OOV table}|$.
  - `src/lib/tokenizers/types.ts:33-39,86-91` (modify) — `EncodedText.vocabSize`
    is $K_{\text{eff}}$ **at the time of the encode call** (instance table), not the
    input's own count; `oovTokens` is a per-instance append-only table.
  - `src/lib/tokenizers/registry.ts:36,39,40-42` (modify) — replace “per-input” with
    “per-instance” / “for the tokenizer instance”; keep the `$...$` tooltip math.
  - `src/lib/engine/README.md:31-32` (modify) — “the instance's append-only OOV
    table”.
- Tests: none (copy/docs); `registry.test.ts`'s existing tooltip-math and
  entry-shape assertions must still pass unchanged.
- Covers: AC4, R1-N8, NR4
- Commit: `docs(#77): R2-N8 describe OOV ids as per-instance`
- Reviewer note: This slice is prose only. Check there is no remaining “per-input”
  wording that describes the table (the encoded result may still be called
  per-input).

### S5 — Keep construction errors out of the vocabulary URL prefix

- Kind: behavioral
- Budget: ≤35 changed lines
- Files: `src/lib/tokenizers/word-vocab-loader.ts` (modify) — declare `words`
  before the `try`, assign `const parsed` / `words = parseWordVocab(parsed)` inside
  the `try`, and `return createWordTokenizer(info, words)` after the catch. Keep
  the fetch/parse catch prefix and `cause` unchanged. Update the doc comment
  (`:36-40`) so it says only fetch/parse failures carry the URL.
- Tests: `src/lib/tokenizers/word-vocab-loader.test.ts` (modify) — add a case that
  forces construction to fail (e.g. `vi.resetModules()` + `vi.doMock('./word-vocab.js',
  () => ({ parseWordVocab: () => [] }))` so `createWordTokenizer` throws on an empty
  list) and assert the rejection message does **not** contain the base URL and does
  contain the constructor's message.
- Covers: AC3, R1-N3
- Commit: `fix(#77): R2-N3 stop prefixing construction errors with the vocabulary URL`
- Reviewer note: Fetch/parse errors must still carry the URL; only the tokenizer
  construction happens after the catch.

### S6 — Dedupe concurrent tokenizer loads with a pending-promise cache

- Kind: behavioral
- Budget: ≤80 changed lines
- Files: `src/lib/tokenizers/registry.ts` (modify) — add
  `const _pending = new Map<string, Promise<Tokenizer>>()`. In `loadTokenizer`,
  after the resolved `_cache` hit, return `_pending.get(id)` if present. On a miss,
  validate id/loader first, then create one promise that calls
  `loader(info, onProgress)`, writes `_cache` and deletes `_pending` on success,
  and deletes `_pending` before rethrowing on failure. Store it in `_pending`
  before awaiting and return it. Document that a concurrent caller shares the first
  caller's progress callback.
- Tests: `src/lib/tokenizers/registry.test.ts` (modify) — mock
  `./word-vocab-loader.js` (and, if needed, `./hf-tokenizer.js`) with a deferred
  loader spy; use `vi.resetModules()` + dynamic import so each test gets a fresh
  module cache. Assert (a) two concurrent `loadTokenizer('words')` calls return the
  same instance and invoke the loader exactly once, (b) a second call after
  resolution returns the cached instance without loading, (c) a rejected load is
  not cached and a retry invokes the loader again.
- Covers: AC3, R1-N4
- Commit: `fix(#77): R2-N4 dedupe concurrent tokenizer loads`
- Reviewer note: Check rejection cleanup cannot leave a permanently rejected
  promise in `_pending`, and that concurrent callers do not race a second fetch.

### S7 — Keep the exported vocabulary out of the worktree by default

- Kind: behavioral
- Budget: ≤20 changed lines
- Files: `scripts/export_word_vocab.py` (modify) — change `--out` default from
  `word-vocab-50k.json` to `dist/word-vocab-50k.json` (already gitignored), and
  create the parent directory before writing (`Path(args.out).parent.mkdir(
  parents=True, exist_ok=True)`); update the argparse help and module docstring to
  state the default. An explicit `--out` still writes wherever requested.
- Tests: none committed (no Python test runner in the repo); verify manually with
  a 25-line synthetic GloVe-shaped source and `--no-upload` that the file lands in
  `dist/` and `git status --porcelain` stays clean.
- Covers: R1-N5
- Commit: `fix(#77): R2-N5 keep the exported vocabulary out of the worktree`
- Reviewer note: Confirm the default path is ignored by git and that `dist/` is not
  the SvelteKit `build/` output.

### S8 — Report which common-word probes are actually missing

- Kind: behavioral
- Budget: ≤15 changed lines
- Files: `scripts/export_word_vocab.py` (modify) — run the sanity check only when
  `len(words) >= 20`; compute `missing = sorted(COMMON_WORDS - found)` and print
  those in the warning (with the real probe count, `20`), instead of printing the
  whole `COMMON_WORDS` set.
- Tests: none committed; verify manually by pointing `--source` at a non-GloVe file
  (expect a warning naming the missing probes) and at a 25-line GloVe-shaped file
  (expect no warning).
- Covers: R1-N6
- Commit: `fix(#77): R2-N6 report which common-word probes are missing`
- Reviewer note: Confirm the warning can no longer claim “first 20” when fewer than
  20 words were read.

### S9 — Clamp byte progress against a compressed content-length

- Kind: behavioral
- Budget: ≤35 changed lines
- Files: `src/lib/tokenizers/word-vocab-loader.ts` (modify) — in the progress
  callback use `Math.min(1, loaded / total)` when `total > 0`. Keep `null` when
  unknown.
- Tests: `src/lib/tokenizers/word-vocab-loader.test.ts` (modify) — add a case where
  the `content-length` header is smaller than the decoded body length and assert
  every emitted fraction is ≤1 (and none exceeds 1); keep the existing
  monotonic-to-1 test unchanged.
- Covers: AC3, R1-N7
- Commit: `fix(#77): R2-N7 clamp decoded byte progress`
- Reviewer note: Clamping must not turn an unknown total into a fake fraction.

### S10 — Document the export script's default output path

- Kind: mechanical
- Budget: ≤5 changed lines
- Files: `src/lib/tokenizers/README.md:86-91` (modify) — the runbook says the
  script writes `word-vocab-50k.json`; change it to the new default
  `dist/word-vocab-50k.json` and note that `--out` overrides it. Do not change the
  hosting/pinning instructions.
- Tests: none (docs).
- Covers: R1-N5
- Commit: `docs(#77): R2-N5 note the default export path`
- Reviewer note: Confirm the pinned-sha instruction and asset name are untouched.

## Coverage

- AC1 (round-trip, OOV unchanged and labelled in prose/chips/graph) — S2 forwards
  the table to the full-graph worker; `graph-store.test.ts` asserts the posted
  message carries it; `token-label.test.ts` proves the label is the word, not
  `#id`; existing e2e test 1 covers prose/chips/hover. Canvas graph labels are not
  DOM-assertable, so the full-graph check is unit plus manual smoke.
- AC2 (uniform/absorbing masks, `[MASK]`, no collisions) — S3 pins the sentinel's
  instance-table contract in the status/e2e; existing e2e test 2 asserts `[MASK]`
  at the sentinel id; `token-label.test.ts` asserts sentinel preference over OOV.
- AC3 (fresh load + IDB reload) — S5 and S9 keep the loader's error/progress
  contracts; S6 dedupes loads; existing e2e test 3 asserts one vocabulary request
  across reload.
- AC4 (editing changes $K_{\text{eff}}$ without stale state) — S3 proves the
  cumulative table across two edits; S4 aligns docs with the cache-key semantics;
  existing trajectory-cache and e2e mask tests cover no collisions.
- AC5 (gates) — S1 fixes the prettier failure; every slice runs the slice gate;
  the round runs `npx prettier --check .`, `npm run test` and `npm run e2e`.
- NR1 — every commit's trailer block is contiguous; verification reads
  `%(trailers)`.
- NR2 — each slice is pushed and PR #81 checks are confirmed on the new head.
- NR3 — no diff-report, asset, upload or revision changes; out of scope below.
- NR4 — S3 and S4 implement the instance-table decision; its rationale is recorded
  above.

## Smoke steps

Extend the existing `e2e/word-tokenizer.spec.ts` (no new spec):

1. Select `Word vocabulary (50k)`, enter `the quick zorblax jumps` → prose shows
   `zorblax` unchanged, the chip has `aria-label="token zorblax"`, and the hover
   tooltip shows `zorblax` (existing testids `input-text`, `prose-token`,
   `[role="tooltip"]`).
2. Status reads `(+2 OOV seen)` → edit to `the zorblax quux` and recompute →
   `(+3 OOV seen)` although that input has two distinct OOV tokens (testid
   `app-status`); this pins the instance-table contract.
3. Run `absorbing` to the final step → the output contains `[MASK]` and the
   sentinel chip id equals the current $K_{\text{eff}}$ (testid `output`; chip
   selector `[title="id: N"]`).
4. Reload the page → the vocabulary route is not requested again and the app
   returns to a ready status (existing fixture route counter).
5. Manual (canvas has no DOM testid): open the graph view with the OOV text →
   the node label shows `zorblax`, not `#41`; automated coverage for this is the
   graph-store message test.

Required stable testids already exist: `input-text`, `noise-button`, `app-status`
(with `data-trajectory-status`), `output`, `prose-token` (with `data-token-id`).
No new testid is required.

## Verification

Per slice, after staging the slice:

```bash
node scripts/slice-check.mjs --budget <slice budget from the slice>
git log -1 --format='%(trailers)'
```

The script runs `npm run check` → `lint` → `format` → `test`, stages, and reports
the changed-line count; it must exit 0. Then commit with a contiguous trailer
block, for example:

```text
fix(#77): R2-B1 forward OOV labels to the union graph

Slice: S2/10
Kind: behavioral
```

Per round, before pushing and again after the last slice:

```bash
npx prettier --check .
npm run test
npm run e2e
git push
gh pr checks 81
```

`npm run e2e` requires the built/previewed site on port 4173 (the npm script does
both). Confirm the PR checks run on the pushed head (NR2). Do not edit the diff
report (NR3).

## Edge cases and risks

- **$K_{\text{eff}}$ choice confirmed.** The human confirmed the instance table
  (per-instance, append-only OOV ids) for sentinel safety and cache semantics.
  The mask sentinel must stay on the instance table even if a per-input count is
  ever displayed separately.
- **Pending-promise cache and progress.** A second concurrent caller shares the
  first caller's `onProgress`; this is acceptable because the page guards
  concurrent selects and the worker does not render progress for its own load.
  Rejections must delete the pending entry or failed loads become permanent.
- **Registry tests and module state.** `_cache`/`_pending` are module-private and
  the loaders are static imports; tests must use `vi.resetModules()` + dynamic
  import + `vi.doMock` so cases do not leak into each other.
- **Status string coupling.** The e2e assertions at `:49/:92/:107` are the only
  places pinning the copy; update them in S3 or the suite goes red.
- **Python has no test runner.** S7/S8 are verified manually with synthetic
  sources; keep the changes small and deterministic.
- **Canvas graph.** Full-graph labels are painted on a `<canvas>`; do not add an
  e2e assertion that cannot read them. The regression is the wire-message test.
- **Round size.** ~230 changed lines across ten slices; well under the 400-line
  revision risk threshold.

## Out of scope

- Editing `.ai/.../round-1/diff-report.md` or the round-1 plan (NR3).
- Re-running `scripts/export_word_vocab.py`, uploading, or changing
  `HF_DATASET_REVISION` (the 50k asset is live).
- Changing the e2e fixture vocabulary or making words the default tokenizer.
- A new per-input OOV counter in the UI beyond the “seen” label.
- Vectors, prose-span changes, lexical tuning at $K = 50{,}000$, rank-based floors.
- `package.json` version bump (round 1 already bumped once).

## Findings and actions

- R1-B1 → S2: forward `oovTokens` in the union-graph message; regression test on
  the posted message. No unrelated graph changes.
- R1-N1 → S1: add the missing semicolon; prettier gate proves it.
- R1-N2 → S3: keep the instance-table number, label it “seen”, and pin the
  semantics in e2e; NR4 records the contract. No per-input counter.
- R1-N3 → S5: move `createWordTokenizer` after the catch; test that construction
  errors are not URL-prefixed.
- R1-N4 → S6: pending-promise cache keyed by tokenizer id; tests for dedupe,
  resolved hits and rejection retry.
- R1-N5 → S7 (default path) + S10 (runbook): default to gitignored `dist/`, create
  the parent, document the override.
- R1-N6 → S8: gate the probe check on 20 words and name the missing probes.
- R1-N7 → S9: clamp the fraction to 1 and test a mismatched content-length.
- R1-N8 → S4: replace “per-input” with “per-instance” for the OOV table in
  `AGENT_CONTEXT.md`, `types.ts`, `registry.ts` and the engine README. No
  no-change decisions.
