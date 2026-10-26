# Plan: Issue #78 — GloVe word-vector source (round 2 revision)

- Round: 2
- Addresses: R1-N1, R1-N2, R1-N3, R1-N4, R1-N5
- Slices: 5
- Estimated size: 75 changed lines

## Goal and acceptance criteria

Round 2 closes the five open findings of the round-1 review on PR #82
(verdict `fix-and-recheck`). No product behaviour changes: the round makes the
e2e gate green, makes the offline exporter deterministic about duplicate
source lines, tightens the GloVe source test, and makes the embeddings README
describe the shipped state. The issue's acceptance criteria are unchanged:

- **AC1** — Selecting `embedding-knn` with the word tokenizer active keeps the
  `words` tokenizer and selects the GloVe word source; word tokens scrub
  without extra configuration.
- **AC2** — Substituted words come from the 50k vocabulary; an OOV word
  changes only through the ergodicity floor or the absorbing mask, never
  through a neighbour list.
- **AC3** — Ids $\geq K$ never read a matrix row (seeded randomized id sweep)
  and `getLocalDistribution(oovId)` returns a valid distribution over
  $K_{\\text{eff}}$.
- **AC4** — Meta/vocabulary alignment is enforced through `vocabSha`, and the
  worker's source/tokenizer pairing and vocab-size checks pass.
- **AC5** — `check`, `lint`, `format`, `test` and `npm run e2e` pass.

## Slices

### S1 — Make the absorbing smoke test assert the masked terminal state

- Kind: behavioral
- Budget: ≤35 changed lines
- Files: `e2e/smoke.spec.ts` (modify) — replace the three-fraction prose
  loop at :36-39: assert non-empty prose at `frac = 0` and `frac = 0.5`
  (`Math.round(max * frac)`), then fill `max`, click
  `getByRole('radio', { name: 'Tokens', exact: true })`, and assert the
  `output` div is non-empty, that `[title^="id: "]` chips are visible, and —
  when `id === 'absorbing'` — that `output` contains the literal `[MASK]`;
  `.ai/78-.../round-1/diff-report.md` (modify, artifact only, excluded from
  the budget) — correct the "Final `npm run e2e`: 11 tests passed" claim at
  :63-66 to the actual 10/11 result, naming the failing test and R1-N1.
- Tests: none new; this slice is the test.
- Covers: AC5
- Commit: `fix(#78): R2-N1 assert the masked terminal state in the tokens view`
- Reviewer note: The prose view filters the mask sentinel out
  (`src/routes/+page.svelte:224-231`), so an empty `output` at $t = T$ for
  `absorbing` is correct behaviour, not a render bug; the Tokens view keeps
  `[MASK]` chips (`src/lib/components/TokenChips.svelte:25-48`, chip titles at
  :30), as `e2e/word-tokenizer.spec.ts:99-101` already assumes. The toggle has
  no testid, hence the `role="radio"` locator. Convince yourself the assertion
  still fails if the page stops rendering tokens at $t = T$.

### S2 — Count duplicate GloVe lines once and keep the first vector

- Kind: behavioral
- Budget: ≤30 changed lines
- Files: `scripts/export_word_vectors.py` (modify) — add `import sys`; in
  `load_glove_rows` (:69-107) replace `seen = bytearray(...)` + `found` with
  `first_line: dict[int, int]` and `duplicates: list[str]`; after the
  vector-length/numeric validation, a word already in `first_line` is skipped
  and recorded as `"{path}:{line_no}: duplicate vector for {word!r} (first at
  line {n})"`, otherwise its line number is stored and the row assigned; after
  the loop print one warning to `sys.stderr` with the first 10 duplicates plus
  `(+N more)`, derive `missing` from `first_line`, and log
  `matched {len(first_line):,} of {VOCAB_SIZE:,} vocabulary words`.
  Contract: exactly one row per vocabulary word, in rank order; a duplicate
  source line must not change the matrix, the row count, or the log count.
- Tests: none committed (the repo has no Python test harness and no
  `test_*.py`); verified manually in the Verification section with a
  two-word duplicate and a missing-word file.
- Covers: AC4 (bundle reproducibility), AC2 (row identity per word id)
- Commit: `fix(#78): R2-N4 report duplicate GloVe lines instead of recounting them`
- Reviewer note: The fix must not raise, because `glove.840B.300d.txt` is known
  to contain duplicate tokens and a hard failure would block the real export —
  the first occurrence wins deterministically and the warning names the file
  and line. Check that `matched` can no longer exceed 50,000.

### S3 — Pin the GloVe source's id, label and plain name in its test

- Kind: behavioral
- Budget: ≤15 changed lines
- Files: `src/lib/embeddings/sources.test.ts` (modify) — in
  `registers the vocab-aligned GloVe source` (:20-26) add
  `expect(getEmbeddingSource('glove-840b-300d')).toBe(EMBEDDING_SOURCES['glove-840b-300d'])`,
  `expect(getEmbeddingSource('glove-840b-300d').id).toBe('glove-840b-300d')`,
  `label === 'GloVe 840B (300d)'` and `plainName === 'GloVe words'`, matching
  the GPT-2 sibling pattern at :13-18.
- Tests: `src/lib/embeddings/sources.test.ts` — the extended case.
- Covers: AC1, AC4
- Commit: `test(#78): R2-N5 assert the GloVe source identity and display copy`
- Reviewer note: The entry (`src/lib/embeddings/sources.ts:42-57`) and
  `getEmbeddingSource` (:64-71) are unchanged; only assertions are added.

### S4 — Spell out the vocabSha canonical bytes in the docs

- Kind: mechanical
- Budget: ≤10 changed lines
- Files: `src/lib/embeddings/README.md:50-52` (modify) — state "lowercase hex
  SHA-256 over the UTF-8 bytes of `words.join('\n')` with no trailing
  newline", cross-referencing `vocabCanonicalText` (`vocab-sha.ts`) and
  `scripts/export_word_vectors.py:148`; `src/lib/embeddings/types.ts:59-64`
  (modify, doc comment only) — add the no-trailing-newline clause so the type,
  the helper and the exporter agree.
- Tests: none (wording only; `src/lib/embeddings/vocab-sha.test.ts:5-15`
  already pins the canonical text and hash).
- Covers: AC4
- Commit: `docs(#78): R2-N2 pin the vocabSha canonical bytes`

### S5 — State that the GloVe bundle is not yet hosted

- Kind: mechanical
- Budget: ≤10 changed lines
- Files: `src/lib/embeddings/README.md:72-91` (modify) — mark
  `glove-840b-300d` as authored but not yet uploaded, note that the pinned
  `HF_DATASET_REVISION` (`src/lib/embeddings/loader.ts:30`) does not contain
  the four GloVe artefacts so selecting the source against production 404s,
  and point at `## Adding a source` step 3 for the upload-and-pin path.
- Tests: none (documentation only; do not touch `loader.ts`).
- Covers: AC4
- Commit: `docs(#78): R2-N3 mark the GloVe bundle as pending upload`
- Reviewer note: The revision pin must stay unchanged; the README should
  describe the shipped state, which is "artefacts pending".

## Findings and actions

- **R1-N1** → S1: the smoke assertion now allows the legitimately empty prose
  view at $t = T$ and proves the tokens view still renders `[MASK]`; the
  round-1 diff-report's e2e line is corrected in the same slice.
- **R1-N2** → S4: README and the `vocabSha` type comment state UTF-8 bytes and
  no trailing newline.
- **R1-N3** → S5: the hosting inventory marks the GloVe bundle as pending
  upload and the revision as unchanged.
- **R1-N4** → S2: duplicates are reported once per skipped line (file and line
  number), the first occurrence wins, and the log counts vocabulary words.
  Raising was rejected: real `glove.840B.300d.txt` duplicates would block the
  export.
- **R1-N5** → S3: the test goes through `getEmbeddingSource` and asserts id,
  label and plain name.

## Coverage

- **AC1** — Satisfied by round 1 (S4b, S6); round 2 adds no behaviour change
  and S3 tightens the test evidence for the registered source identity.
- **AC2** — Satisfied by round 1 (S1, S5, S7 tests); S2 keeps the exported
  matrix one-row-per-word so word ids stay aligned with the vocabulary.
- **AC3** — Satisfied by round 1 (`knn-index.test.ts`,
  `embedding-distance-model.test.ts`, `embedding-knn.test.ts`); untouched in
  round 2, proven by the per-round `npm run test`.
- **AC4** — S2 (exporter row contract), S4 (canonical-byte contract),
  S5 (hosting state) and S3 (source entry); worker pairing/size checks are
  unchanged from round 1.
- **AC5** — S1 makes the e2e gate green; every slice re-runs
  `node scripts/slice-check.mjs`, and the round runs `npm run test` plus
  `npm run e2e` before pushing.

## Verification

- Per slice: `node scripts/slice-check.mjs --budget <slice budget>` (runs
  `npm run check` → `lint` → `format` → `test`, stages, and checks the size).
- S1 also run: `npx playwright test e2e/smoke.spec.ts -g absorbing --reporter=list`
  and then the full `npx playwright test`.
- S2 manual exporter check (no CI coverage, no committed fixture):

  ```bash
  python3 - <<'PY'
  import importlib.util, pathlib, tempfile
  spec = importlib.util.spec_from_file_location("exw", "scripts/export_word_vectors.py")
  m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
  m.VOCAB_SIZE, m.DIM = 4, 3
  d = pathlib.Path(tempfile.mkdtemp())
  dup = d / "glove.txt"
  dup.write_text("a 1 2 3\nb 1 2 3\na 9 9 9\nc 0 0 0\nd 0 0 0\n")
  rows = m.load_glove_rows(str(dup), ["a", "b", "c", "d"])
  assert rows.shape == (4, 3)
  assert rows[0].tolist() == [1, 2, 3]  # first occurrence wins
  miss = d / "missing.txt"
  miss.write_text("a 1 2 3\nb 1 2 3\nc 0 0 0\n")
  try:
      m.load_glove_rows(str(miss), ["a", "b", "c", "d"])
  except ValueError as error:
      assert "'d'" in str(error), error
  else:
      raise SystemExit("expected a missing-vector error")
  PY
  ```

  Expected: one stderr warning naming `glove.txt:3` (duplicate of `'a'`),
  `matched 4 of 4 vocabulary words`, and the missing-word error naming `'d'`.
- Per round, before pushing: `npm run test` once more and `npm run e2e`
  (AC5). Round 2 has no `## Smoke steps` section because nothing
  user-visible changes, but the e2e suite is still required.

## Edge cases

- Slider values must be integers: use `Math.round(max * frac)` so a future
  `T` that is not even still yields a valid `fill` value.
- The view toggle exists only after a trajectory is ready and is disabled
  until then; the suite already waits for `time-slider` to be enabled first.
- A non-empty input always has at least one chip at $t = T$; the Tokens view
  is therefore never empty for the smoke strategies.
- The `[MASK]` assertion is gated on `id === 'absorbing'`; other strategies do
  not produce sentinels.
- Duplicate detection runs after vector-length validation so a malformed
  duplicate line still fails loudly instead of being skipped.
- An all-duplicate GLoVe file still yields `matched K of K`; a file missing
  words keeps the existing `ValueError` with the first 10 previews.

## Risks

- S1 edits a round-1 `.ai/` artefact. It is bookkeeping (the report must not
  claim a result that does not reproduce), carries no code, and is excluded
  from the size budget; the behavioural part of the slice is the spec.
- R1-N4 warns rather than raises: a duplicate with a *different* vector keeps
  the first value, so a corrupt source aborts only via the warning line, not
  the exit code. Accepted to keep the real GloVe export possible.
- The e2e suite takes ~3 minutes; a red run should be re-checked against the
  single failing spec before it is treated as a regression.
- Total revision estimate is ~75 lines, far below the 400-line revision
  threshold.

## Out of scope

- The review's "Missing tests and verification gaps" list (worker-level
  `vocabSha` mismatch test, exporter unit tests, `precomputeRows`/`materialize`
  OOV coverage, e2e OOV-reachability assertion, `vocabSize` tie-out,
  determinism/all-OOV cases): advisory only, not in the `- Open findings:`
  line.
- Uploading the GloVe artefacts or bumping `HF_DATASET_REVISION`; hiding the
  picker entry until the pin moves; changing source↔tokenizer precedence;
  Danish fastText; retuning $\tau$, $k$ or $\varepsilon$; a version bump
  (already done in round 1).

## Open blocking questions

- None.
