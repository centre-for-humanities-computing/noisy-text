- Round: 4
- Addresses: R3-N1, R3-N2, R3-N3, R3-N4, R3-N5, R3-N6, R3-N7
- Slices: 4
- Estimated size: 120 changed lines

## Goal and acceptance criteria

Issue #48 — Fix prose view for uncased BERT tokenizer.

Body: "Right now the recency highlights are misaligned for the bert tokenizer, and the misalignment becomes more severe the further in the text you are."

The rendering fix landed in rounds 1-3. This revision round closes the round-3
review findings on the differential harness, the noised e2e assertion, one
hand-picked test, and two documentation nits. It changes no production code.

- AC1: With `bert-base-uncased` in prose view, every token highlight covers exactly that token's characters in the decoded prose text, including a continuation token at the first visible position.
- AC2: The misalignment does not accumulate: for an unmasked sequence the final token's span ends at the end of the decoded prose.
- AC3: The GPT-2 prose view and the chips view keep working exactly as before, including tokens whose decoded text starts with `##`.
- AC4: The span mapping is covered by a seeded randomized differential test against a naive reference implementation, in addition to hand-picked cases, and the mask-skip path is load-bearing.

## Findings and actions

- R3-N1 — addressed in S1: `decodeStub` models the first-visible `##` rule, `naiveSpans` and the per-span expected text use the visible position, the mask generator allows a continuation directly after a mask, and the test asserts at least one case actually generated a first-visible continuation.
- R3-N2 — no change: the S5 docs content is correct at HEAD (`0523c7b`); splitting it into its own commit now requires rewriting that published commit, which `/implement` must not do on the shared PR branch. S4 is a fresh mechanical docs slice with correct `Slice: S4/4` / `Kind: mechanical` trailers, so round-4 accounting is clean; a literal retroactive split is a history-rewrite decision for the human.
- R3-N3 — no change: HEAD already pairs `hello world` with `gpt2` (`e2e/fix-prose-view-for-uncased-bert-tokenizer.spec.ts:40-48`) and that fixture passes; fixing `40da0f5` retroactively needs a history rewrite. The per-round `npm run e2e` in Verification proves HEAD is green, and S3 keeps the pairing unchanged.
- R3-N4 — addressed in S3: the noised-phase `##` allowance is restricted to span index 0.
- R3-N5 — addressed in S4: the `alignTokenPieces` JSDoc moves the whitespace-equivalence argument from rule 1 to rule 2.
- R3-N6 — addressed in S4: DESIGN.md describes WordPiece's decode as joining pieces with spaces and dropping `##` plus its preceding space from continuations.
- R3-N7 — addressed in S2: the later-`##` case derives `laterText` with `decodeWord(vocabBert, [1, 0])`.

## Slices

### S1 — Make the mask differential model the first-visible `##` rule and continuations after masks

- Kind: behavioral
- Budget: ≤150 changed lines (estimated 90)
- Files: `src/lib/engine/diff.test.ts` (modify) — no exports change. `decodeStub(rawTokens: readonly string[]): string` keeps `##` on the first visible piece and strips it only from later pieces; `naiveSpans(rawTokens: readonly string[]): { start: number; end: number }[]` uses the first-visible rule; the mask generator allows `##` after a mask.
- Tests: `src/lib/engine/diff.test.ts` — the existing seeded tests `matches the naive reference on random WordPiece sequences` (line 666) and `routes mask sentinels through allTokenCharSpans to the naive reference` (line 697). Steps:
  1. In `decodeStub` (lines 611-626) replace `const isCont = raw.startsWith('##');` with `const isCont = raw.startsWith('##') && !first;` and update the JSDoc (602-610) to say the stub keeps `##` on the first visible piece and strips it from later continuations. Leave the `raw === ''` branch (which sets `first = false`) unchanged: an empty piece occupies a visible position, matching `allTokenCharSpans`, whose `pieces.length` counts it.
  2. In `naiveSpans` (634-646) replace `const isCont = raw.startsWith('##');` with `const isCont = raw.startsWith('##') && k > 0;`.
  3. In the mask generator (lines 714-716) delete the `!isMask[rawTokens.length - 1] &&` clause from the `isCont` condition, so a continuation may directly follow a mask. Do not touch the empty-piece rule at line 713.
  4. In the lockstep filter (lines 753-761) add `const keptPieceText: string[] = [];` and, inside the `if (e.end > e.start)` block, push the expected rendered text using the visible position `k`: `const raw = rawTokens[orig]!; const isCont = raw.startsWith('##') && k > 0; keptPieceText.push(isCont ? raw.slice(2) : raw);`.
  5. Replace the per-span computation at line 770 (`const pieceText = raw.startsWith('##') ? raw.slice(2) : raw;`) with `const pieceText = keptPieceText[k]!;` and keep the assertion at 777.
  6. Add `let sawFirstVisibleContinuation = false;` before the case loop (line 700), set it inside the loop with `if (visible.length > 0 && visible[0]!.startsWith('##')) sawFirstVisibleContinuation = true;` after `visible` is computed (line 737), and after the loop add `expect(sawFirstVisibleContinuation).toBe(true);` with a comment that this pins the first-visible rule as exercised, not just available.
- Covers: AC1, AC2, AC3, AC4
- Commit: `test(#48): R3-N1 exercise the first-visible ## rule in the mask differential`
- Reviewer note: Convince yourself the new generator produces a continuation after a mask (so the first visible piece is a continuation), that `decodeStub`, `naiveSpans`, and `keptPieceText` agree with `allTokenCharSpans` on the first-visible rule, and that reverting `diff.ts:254` to unconditional stripping makes this test fail.

### S2 — Derive the later-`##` expected text through `decodeWord`

- Kind: behavioral
- Budget: ≤40 changed lines (estimated 4)
- Files: `src/lib/engine/diff.test.ts` (modify) — test-only.
- Tests: `src/lib/engine/diff.test.ts`, test `keeps a piece that is exactly ## when first visible and drops it when later` (575-599). Replace line 592 `const laterText = 'dog';` with `const laterText = decodeWord(vocabBert, [1, 0]);` and keep the surrounding comment accurate (the helper strips the later `##` piece to `''`). `expect(laterText).toBe('dog')` is not needed; the existing span assertions pin the result.
- Covers: AC1
- Commit: `test(#48): R3-N7 derive the later ## text with decodeWord`
- Reviewer note: The helper's later-`##`-strips-to-empty path is now exercised through `decodeWord` rather than a hardcoded literal, and the test still asserts `['dog']` / `[[0, 3]]`.

### S3 — Allow the `##` prefix only on the first noised span

- Kind: behavioral
- Budget: ≤40 changed lines (estimated 8)
- Files: `e2e/fix-prose-view-for-uncased-bert-tokenizer.spec.ts` (modify) — assertion-only.
- Tests: `e2e/fix-prose-view-for-uncased-bert-tokenizer.spec.ts`, noised-phase loop (153-182). At line 180-181 the condition is `A || B`, where `A` is `rendered === expected!` and `B` is the existing template-literal comparison against the `##`-prefixed text; change it to `A || (i === 0 && B)`, keeping the `expect(...).toBe(true)` wrapper and the template literal unchanged. Update the comment at 174-177 to say only the first visible piece can gain the prefix (it is a continuation whose predecessor was masked); later continuations are always stripped.
- Covers: AC1, AC3
- Commit: `test(#48): R3-N4 restrict the noised ## prefix to the first span`
- Reviewer note: The assertion now rejects a later span that swallows the first token's `##` characters, while still accepting a masked predecessor that promotes a continuation to visible position 0. All three fixtures keep passing.

### S4 — Correct the alignment JSDoc rule attribution and the DESIGN separator wording

- Kind: mechanical
- Budget: ≤60 changed lines (estimated 18)
- Files: `src/lib/engine/diff.ts` (modify) — comments only, no signature or behavior change; `DESIGN.md` (modify) — prose only.
- Tests: none (comments and docs).
- Steps:
  1. `src/lib/engine/diff.ts:129-144`: change the opening claim to "WordPiece's whole-sequence decode inserts spaces between non-continuation pieces". Rewrite rule 1 as "Exact match at the cursor — covers GPT-2-style pieces whose leading space is part of the piece text." Move the parenthetical equivalence argument to rule 2: "`indexOf` fallback — search forward from the cursor for WordPiece separators inserted by the whole-sequence decode and for cleanup artifacts; a non-empty piece that matches after a whitespace-only gap matches at that first non-whitespace character, which `indexOf` finds from the cursor." Keep the not-found sentence in rule 2 and the empty-piece note below unchanged.
  2. `DESIGN.md:281-291`: replace "whose whole-sequence decode inserts a space before non-first pieces" with "whose whole-sequence decode joins pieces with spaces and drops the `##` and its preceding space from continuations (only non-continuation pieces after the first gain a separator)". Keep the rest of the paragraph, including the first-visible and GPT-2 clauses, unchanged.
- Covers: none (documentation accuracy)
- Commit: `docs(#48): R3-N5 R3-N6 correct the alignment docs`
- Reviewer note: Check the JSDoc now attributes separator handling to rule 2 only, and the DESIGN sentence is faithful to `decodeWord`/`WordPiece` behavior: space-joined, then `" ##"` removed, so continuations get no space and the first token gains none.

## Coverage

- AC1 — S1's seeded mask differential now generates first-visible continuations and checks them against the naive reference; S3 tightens the browser assertion to the first span only; the existing hand-picked first-visible tests (`diff.test.ts:532-573`) and the BERT e2e fixture still pass. Proof: `npx vitest run src/lib/engine/diff.test.ts` and `npm run e2e`.
- AC2 — S1's differential covers every case's final span end against the naive prefix-length reference, including the newly generated mask-adjacent continuations; the existing final-span assertions (`diff.test.ts:495-496`, e2e end-of-text assertion) remain. Proof: the S1 test plus the full `npm run test` / `npm run e2e`.
- AC3 — S1 leaves the non-mask generator untouched (index 0 is never a continuation there) and only changes the first-visible `##` rule, so the GPT-2 hand-picked tests (`diff.test.ts:499-530`) and GPT-2 fixtures (`hello world`, `## heading`) must still pass; S3 keeps those fixtures and only tightens the noised branch. Proof: `npm run test` and `npm run e2e`.
- AC4 — S1 makes the seeded differential model the first-visible rule (previously 0/200 cases), allows continuations after masks, and asserts coverage with `sawFirstVisibleContinuation`; the mask-sentinel spy remains load-bearing at `diff.test.ts:743`. Proof: the S1 test passes at HEAD and fails when `diff.ts:254` is temporarily reverted to unconditional stripping.

## Verification

- Per slice: `node scripts/slice-check.mjs --budget <slice budget>` (runs
  `npm run check` → `lint` → `format` → `test`, stages, and checks the size).
  Budgets: S1 150, S2 40, S3 40, S4 60.
- S1 load-bearing check (not committed): temporarily change
  `src/lib/engine/diff.ts:254` to
  `const isContinuation = wordPiece && raw.startsWith('##');`, run
  `npx vitest run src/lib/engine/diff.test.ts -t "routes mask sentinels"`,
  confirm it fails, then revert. Also confirm the `sawFirstVisibleContinuation`
  assertion fires (the old generator would have failed it).
- Per round, before pushing: `npm run test` once more, then `npm run e2e`
  (install Chromium once with `npx playwright install chromium`; e2e needs
  network access for tokenizer weights). S3 edits the e2e spec, so e2e is
  required even though this revision changes no user-visible behavior.
- Do not bump `package.json`: issue #48 was already bumped to 1.6.1 in round 1
  (`ad6059b`), and later review rounds do not bump again.

## Edge cases, risks, and out-of-scope

- Dropping the `!isMask[...]` guard consumes prng draws differently, so all 200
  mask cases change from round 3. This is intended and deterministic; the seed
  stays `'align-token-spans-masks' + '\0'`.
- `decodeStub` is shared with the non-mask differential. Its index 0 can never
  be a continuation (the generator requires `rawTokens.length > 0`), so that
  test's expectations are unchanged; still run it.
- An empty piece sets `first = false` in `decodeStub`, matching
  `allTokenCharSpans`' `pieces.length` count. Do not change this to first
  non-empty.
- In the mask differential, the visible-position index `k` is the position in
  the filtered list; using `keptIdx` or the assertion-loop index instead would
  misclassify spans after dropped empty pieces.
- e2e still requires network access for tokenizer weights.
- Revision estimate is ~120 changed lines, well under the 400-line slice cap.
- Out of scope: the other gaps listed under the review's "Missing tests and
  verification gaps" (mask spy call count/id set, whitespace-prefixed piece,
  GPT-2 multi-byte piece, offline e2e skip, requiring a `##` render) are not on
  the `- Open findings:` line. Also not cited: the same separator wording in
  `docs/libraries.md:16-18` and `src/lib/tokenizers/README.md:33-38`; leave
  them unchanged.
- Out of scope: rewriting the round-3 history (R3-N2, R3-N3).

## Open blocking questions

None. R3-N2 and R3-N3 are recorded as explicit no-change decisions because
resolving them literally requires amending or rewriting published commits. If
the human wants that, it needs an explicit, separate history-rewrite request.
