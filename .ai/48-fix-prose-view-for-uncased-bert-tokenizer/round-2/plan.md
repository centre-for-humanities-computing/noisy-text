- Round: 2
- Addresses: R1-B1, R1-B2, R1-N1, R1-N2, R1-N3, R1-N4, R1-N5, R1-N6, R1-N7, R1-N8, R1-N9, R1-N10, R1-N11, R1-N12
- Slices: 6
- Estimated size: 487 changed lines

## Goal and acceptance criteria

Fix the round-1 prose-view implementation so the uncased BERT tokenizer
(`bert-base-uncased`) produces one correct, hoverable span per token,
without regressing GPT-2 or the chips view, and so the tests actually
prove it. Round 1's alignment used the isolated decode of each token,
which for WordPiece retains the `##` continuation prefix
(`tok.decode([id])` returns `"##yp"`, not `"yp"`). Those pieces never
matched the decoded prose, so 5 of 7 tokens were dropped for
`hyphenated hyphen`, and the e2e assertion was tautological.

- AC1: With `bert-base-uncased` in prose view, every token highlight
  covers exactly that token's characters in the decoded prose text.
- AC2: The misalignment does not accumulate: for an unmasked sequence
  the final token's span ends at the end of the decoded prose.
- AC3: The GPT-2 prose view and the chips view keep working exactly as
  before (no regression for tokenizers whose single-token decode already
  carries its leading separator).
- AC4: The span mapping is covered by a seeded randomized differential
  test against a naive reference implementation, in addition to
  hand-picked cases.

## Slices

### S1 — Normalize WordPiece `##` pieces before alignment and make the WordPiece test stub faithful

- Kind: behavioral
- Budget: 180 changed lines
- Files: `src/lib/engine/diff.ts` (modify) — add a module-level
  `const WHITESPACE = /\s/;` and use it in `alignTokenPieces` instead of
  the per-character `/\s/.test(...)` allocation at `src/lib/engine/diff.ts:161`.
  In `allTokenCharSpans` (`:219-250`), build each piece as
  `const raw = decodeToken(id); const text = raw.startsWith('##') ? raw.slice(2) : raw;`
  so a production isolated WordPiece decode (`"##yp"`) aligns as `"yp"`.
  Update `TokenPiece.text` (`:102-110`) to say it is the raw isolated
  decode and may carry a WordPiece `##` prefix, and update the
  `alignTokenPieces` JSDoc (`:120-146`) to remove the false claim that
  exact match covers `##` continuations: callers must normalize piece
  text first (`allTokenCharSpans` does). Keep the greedy-cursor algorithm
  unchanged.
- Tests: `src/lib/engine/diff.test.ts` (modify) — in
  `describe('allTokenCharSpans (WordPiece-style decoder)')` (`:309-373`)
  make the stub faithful to transformers.js `WordPieceDecoder`: the
  single-token `decodeToken` returns the raw vocab entry unchanged
  (including `##`), while the whole-sequence `decodeAll` strips `##` only
  for tokens at position `i !== 0` and joins non-`##` pieces with a
  space. Existing assertions should still pass because
  `allTokenCharSpans` now does the stripping. Add a regression test with
  `vocab = ['h', '##yp', '##hen', '##ated']`, decode `'hyphenated'`, and
  assert the four spans are `[0,1)`, `[1,3)`, `[3,6)`, `[6,10)`, with
  token texts `h`, `yp`, `hen`, `ated` and the original `index` values.
  Add a mixed-word case (`['h','##yp','##hen','##ated', 'h','##yp','##hen']`
  decoding to `'hyphenated hyphen'`) asserting the second word starts at
  character 11, so the old dropped-token behaviour fails the test.
- Covers: AC1, AC2
- Commit: `fix(#48): R1-B1 strip WordPiece prefix before aligning prose spans`
- Reviewer note: The whole fix is the `startsWith('##')` normalization in
  `allTokenCharSpans`; confirm the stub no longer strips `##` in the
  single-token path, because that was what hid the production bug. Check
  that normalizing cannot affect GPT-2 pieces (they never start with
  `##`) and that the hoisted whitespace regex is identical in behaviour.

### S2 — Clarify and test the contract for empty and unalignable pieces

- Kind: behavioral
- Budget: 110 changed lines
- Files: `src/lib/engine/diff.ts` (modify) — update the
  `allTokenCharSpans` JSDoc (`:198-218`) to state the real contract: one
  span per visible, non-mask token that can be located; tokens that
  decode to the empty string or cannot be located in the decoded text
  are omitted because a zero-width span would not be hoverable, and their
  characters remain in the rendered prose as plain (unhighlighted) text.
  Mention that GPT-2 non-ASCII tokens can decode to U+FFFD in isolation
  and are therefore omitted, while the prose text itself is correct.
  Keep the `span.end > span.start` filter (`:238`) unchanged.
- Tests: `src/lib/engine/diff.test.ts` (modify) — add a non-ASCII GPT-2
  case: a stub decoder that returns `'\uFFFD'` for every id, prose
  `'你好世界'`, asserts `allTokenCharSpans` returns `[]` and does not
  throw. Add a case with one locatable piece and one non-empty piece
  absent from the text, asserting the locatable span survives and the
  absent one is omitted without shifting the survivor. Fix the naive
  reference `naiveSpans` (`:396-408`) so an empty piece is placed at the
  current cursor (matching `alignTokenPieces`), make `decodeStub`
  (`:380-390`) skip empty pieces without emitting a separator, and have
  `randomWord` (`:412-419`) emit an empty piece with roughly 5%
  probability (never immediately after a mask or as a continuation) so
  the differential test covers this edge.
- Covers: AC1, AC4
- Commit: `fix(#48): R1-N2 document and test unalignable piece omission`
- Reviewer note: This slice deliberately chooses the "document omission"
  option from R1-N2 rather than inventing a zero-width or guessed span.
  Confirm the documented contract now matches the filter, and that the
  differential reference and implementation agree on empty pieces.

### S3 — Widen the differential test to punctuation, the `indexOf` fallback, and the real mask path

- Kind: behavioral
- Budget: 110 changed lines
- Files: `src/lib/engine/diff.test.ts` (modify) — in the differential
  generator (`:410-447`), add punctuation pieces (`,` `.` `?` `!`) and
  occasional multiple spaces so the whitespace-skip branch is exercised
  by randomized cases; keep `decodeStub` prefix-consistent so the naive
  prefix-length reference remains valid. Add a hand-picked
  `alignTokenPieces` case that can only pass through `indexOf`:
  `text = 'oneXtwoone'`, pieces `one`, `two`, `one` must yield
  `[0,3)`, `[4,7)`, `[7,10)`; a version without the `indexOf` branch
  would leave `two` as an empty span. Replace the mask differential test
  (`:449-483`) so it calls `allTokenCharSpans` (not `alignTokenPieces`)
  with a `MASK` id interleaved in the `Int32Array`, a recency array, the
  faithful single-token stub, and the mask-filtered whole-sequence text:
  assert the mask positions produce no span, and that every remaining
  span still carries the correct `tokenId`, original `index`, and
  text-aligned start/end.
- Covers: AC1, AC4
- Commit: `test(#48): R1-N5 extend span tests to punctuation, fallback, and masks`
- Reviewer note: Confirm the punctuation generator still admits an
  independent naive reference (no cleanup that changes lengths), and
  that the mask test now exercises `allTokenCharSpans`'s own
  mask-skipping loop rather than pre-filtering masks in the test.

### S4 — Make the browser test assert real token spans, wait for readiness, and cover the mask path

- Kind: behavioral
- Budget: 170 changed lines
- Files: `src/lib/components/InlineTokens.svelte` (modify) — add
  `data-token-id={seg.span.tokenId}` to the `prose-token` span (`:52-54`,
  alongside `data-start`/`data-end`). `src/routes/+page.svelte`
  (modify) — on the status element (`:556-561`) add
  `data-testid="app-status"` and
  `data-trajectory-status={trajectoryStore.status}` so the e2e test can
  wait for `'ready'` instead of relying on `time-slider` being enabled
  during `'computing'` (`:547`).
  `e2e/fix-prose-view-for-uncased-bert-tokenizer.spec.ts` (modify,
  effectively rewrite) — define per-tokenizer fixtures:
  `bert-base-uncased` with input `'hyphenated hyphen'`, prose
  `'hyphenated hyphen'`, expected token texts `['h','yp','hen','ated','h','yp','hen']`
  and spans `[[0,1],[1,3],[3,6],[6,10],[11,12],[12,14],[14,17]]`;
  `gpt2` with input `'hello world'`, prose `'hello world'`, expected
  token texts `['hello',' world']` and spans `[[0,5],[5,11]]`.
- Tests: `e2e/fix-prose-view-for-uncased-bert-tokenizer.spec.ts` —
  capture both `pageerror` and `console` errors using the pattern in
  `e2e/smoke.spec.ts:16-20`. Per fixture: fill `input-text`, select
  `tokenizer-<id>`, wait enabled and `aria-checked="true"`, click
  `noise-button`, then wait for `app-status` to have
  `data-trajectory-status="ready"` (120 s). Assert `prose-text` equals
  the fixture prose, the span count equals the expected count exactly,
  each `data-start`/`data-end` equals the expected pair, each slice
  equals the expected token string (not the span's own `textContent`),
  spans are ordered and non-overlapping, and the last `data-end` equals
  the prose length. Record a `data-token-id` → slice map. Then select
  `strategy-absorbing` (wait enabled and `aria-checked="true"`), click
  `noise-button`, wait for `ready`, scrub `time-slider` to 10% of `max`,
  and assert: prose text differs from the fixture input, spans remain
  ordered/non-overlapping, every remaining span's `data-token-id` exists
  in the recorded map and its slice equals that token text, and at least
  one span remains. Assert `errors` is empty.
- Covers: AC1, AC2, AC3
- Commit: `fix(#48): R1-B2 assert real prose token spans in the browser`
- Reviewer note: The key change is that expectations are hardcoded token
  strings and exact spans for an input containing a multi-piece BERT
  word, so a dropped continuation token fails. Check the ready wait uses
  `app-status` (not the slider) and that the post-scrub check uses the
  recorded token-id map rather than comparing a span to itself. Verify
  the 10% scrub leaves at least one token unmasked under the deterministic
  seed; if not, lower the fraction and say so in the commit body.

### S5 — Replace the stale span docs with the alignment contract

- Kind: mechanical
- Budget: 40 changed lines
- Files: `DESIGN.md` (modify) — rewrite §10.2 (`:270-284`): describe
  `alignTokenPieces` and `TokenCharSpan` (one span per located visible
  token, start/end into the decoded prose), the greedy-cursor alignment
  against the whole-sequence decode, and the WordPiece `##` normalization.
  Delete the `CharRange` reference, the cumulative-length description,
  and the sentence claiming adjacent same-recency spans are merged
  (they are not). `docs/libraries.md` (modify, `:14-20`) — scope the
  separator claim to WordPiece: a single-id WordPiece decode omits the
  space the whole-sequence decode inserts and retains `##`, so lengths
  may not sum; GPT-2's byte-level decoder already carries its leading
  space in each isolated decode. `src/lib/tokenizers/README.md`
  (modify, `:30-33`) — same WordPiece scoping.
- Tests: none (documentation only); `git grep -n 'CharRange' -- . ':!.ai'`
  must return nothing.
- Covers: none (docs)
- Commit: `docs(#48): R1-N6 describe the aligned-span algorithm`
- Reviewer note: Skim only; confirm no remaining `CharRange` or
  cumulative-length claim, and that the note no longer implies GPT-2
  lengths fail to sum.

### S6 — Revert the unrelated `/implement` workflow change from the plan commit

- Kind: mechanical
- Budget: 20 changed lines
- Files: `.opencode/command/implement.md` (modify) — restore the file to
  its state before `4070227` (`git show 4070227^:.opencode/command/implement.md`),
  undoing the "clean tree" exception that allows an untracked plan file
  and modified `.opencode/` files to be committed as the round's first
  commit. That change is unrelated to issue #48 and was not in the plan.
- Tests: none; `git diff --stat 4070227^ HEAD -- .opencode/command/implement.md`
  must be empty after this slice.
- Covers: none (workflow cleanup)
- Commit: `chore(#48): R1-N7 revert unrelated implement command change`
- Reviewer note: Confirm the restored file matches `4070227^` exactly and
  no other `.opencode/` file was touched. The round's plan commit is
  already made before this slice runs, so the revert does not prevent
  `/implement` this round; any future need for that workflow change
  belongs in its own PR.

## Coverage

- AC1 — S1 normalizes WordPiece pieces and adds hand-picked
  `hyphenated`/`hyphenated hyphen` regression tests; S3 keeps the
  differential test honest; S4 asserts the exact hardcoded BERT spans in
  the browser for `'hyphenated hyphen'`.
- AC2 — S1's mixed-word test asserts the final span ends at 17; S2's
  differential reference covers longer sequences; S4 asserts the final
  `data-end` equals the prose length before masking.
- AC3 — S1 keeps all existing plain-decoder tests and the GPT-2
  leading-space case; S3 adds GPT-2-style punctuation coverage; S4
  asserts exact spans for `gpt2` with `'hello world'`; chips view is
  untouched (`InlineTokens.svelte` only gains a data attribute).
- AC4 — S3's seeded randomized differential test against the naive
  prefix-length reference (200 cases) plus S2's empty-piece generator;
  S1/S2 hand-picked cases cover the decoder-specific paths.

## Smoke steps

- Enter `hyphenated hyphen`, select `bert-base-uncased`
  (`tokenizer-bert-base-uncased`), click `noise-button` → `prose-text`
  reads `hyphenated hyphen` and there are exactly seven `prose-token`
  elements, including continuation tokens `yp`, `hen`, `ated`.
- Read the `data-start`/`data-end` slices → `h`, `yp`, `hen`, `ated`,
  `h`, `yp`, `hen`, and the last `data-end` is 17.
- Select `strategy-absorbing`, click `noise-button`, scrub
  `time-slider` to 10% → prose is shorter and every remaining
  `prose-token` slice still equals the token text recorded for its
  `data-token-id`.
- Select `gpt2` with `hello world` → two spans, `hello` and ` world`,
  last `data-end` is 11.
- No `console.error` or `pageerror` appears during either tokenizer run.

Required test ids: `input-text`, `noise-button`, `time-slider`,
`tokenizer-bert-base-uncased`, `tokenizer-gpt2`, `strategy-absorbing`,
`app-status` (with `data-trajectory-status`), `prose-text`, `prose-token`
(with `data-start`, `data-end`, `data-token-id`).

## Verification

- Per slice: `node scripts/slice-check.mjs --budget <slice budget>`
  (S1 180, S2 110, S3 110, S4 170, S5 40, S6 20). It runs `npm run check`
  → `lint` → `format` → `test`, stages, and checks the changed-line
  count; exit 2 means split the slice.
- Per round, before pushing: `npm run test` once more, then `npm run e2e`
  (needs network for the tokenizer weights; `playwright.config.ts`
  allows 120 s per test).
- S1/S2/S3 single-file loop while iterating:
  `npx vitest run src/lib/engine/diff.test.ts`.

## Edge cases

- A single-token WordPiece decode of a continuation retains `##`;
  normalization must strip only a leading `##`, never interior text.
- The first token of a word could itself be a `##` piece in pathological
  vocabularies; stripping it is still the right alignment text.
- Empty pieces and pieces that decode to `''` must not emit spans or
  move the cursor.
- Punctuation cleanup in the whole-sequence decode can leave non-space
  gaps; `indexOf` must find the piece without jumping over a repeated
  earlier occurrence (`oneXtwoone`).
- Mask sentinels are skipped in both the prose text and the piece list;
  later spans must not shift after a mask.
- GPT-2 non-ASCII pieces decode to U+FFFD in isolation and are omitted
  from highlights (documented in S2); the prose text itself is unchanged.
- Empty prose (all tokens masked) is a pre-existing limitation and must
  not crash; it is out of scope.

## Risks

- S4's hardcoded tokenizations depend on `Xenova/bert-base-uncased` and
  `Xenova/gpt2` staying the pinned model aliases; a tokenizer-vocab
  change would require updating the fixtures.
- The 10% absorbing scrub relies on the deterministic trajectory seed
  leaving at least one token unmasked; the implementer must confirm this
  locally and lower the fraction if needed.
- Reverting `.opencode/command/implement.md` (S6) is intentional but
  touches workflow docs; it is isolated in a mechanical commit so it can
  be dropped if the human decides otherwise.
- GPT-2 non-ASCII alignment remains a documented limitation, not a fix;
  if the reviewer requires better behaviour it needs a separate
  tokenizer-offset design.
- Revision total (~487 lines) is above 400 but consists of six small,
  independently verifiable slices.

## Out of scope

- Rendering a placeholder when every token is masked (pre-existing
  empty-prose issue noted in the round-1 diff report).
- Making GPT-2 non-ASCII highlights work; isolated byte-level decodes
  cannot recover the character.
- Any change to the chips view (`TokenChips.svelte`).
- Repackaging the `.opencode/command/implement.md` workflow change as its
  own PR (S6 simply removes it from this one).

## Open blocking questions

- None. Decisions recorded: WordPiece prefix stripping lives in
  `allTokenCharSpans` (not the page lambda); unalignable tokens are
  omitted and documented rather than given a guessed span; the
  unrelated `/implement` change is reverted from this PR.

## Findings and actions

- R1-B1 — S1: strip a leading `##` from the isolated piece text inside
  `allTokenCharSpans`; faithful stub plus `hyphenated` regression tests.
- R1-B2 — S4: e2e now asserts exact hardcoded token strings/counts for
  an input with a multi-piece BERT word.
- R1-N1 — S1: single-token stub returns raw `##` text; only non-first
  pieces are stripped in the whole-sequence stub.
- R1-N2 — S2: documented omission contract for empty/unalignable pieces
  plus non-ASCII GPT-2 tests; no fallback span invented.
- R1-N3 — S4: select `strategy-absorbing` and scrub so mask sentinels are
  actually present.
- R1-N4 — S4: `app-status` + `data-trajectory-status` ready wait, and a
  post-scrub assertion that the prose changed.
- R1-N5 — S3: punctuation in the generator, a targeted `indexOf`-only
  case, and no pre-filtering in the mask test.
- R1-N6 — S5: DESIGN.md §10.2 rewritten around `alignTokenPieces`;
  `CharRange` and cumulative-length text removed.
- R1-N7 — S6: `.opencode/command/implement.md` restored to
  `4070227^`; the workflow change should be its own PR.
- R1-N8 — S3: mask differential now calls `allTokenCharSpans` with an
  interleaved mask sentinel.
- R1-N9 — S2: naive reference places empty pieces at the cursor and the
  generator emits occasional empty pieces.
- R1-N10 — S4: e2e captures `console` errors alongside `pageerror`.
- R1-N11 — S5: separator claims scoped to WordPiece in
  `docs/libraries.md` and `src/lib/tokenizers/README.md`.
- R1-N12 — S1: module-level `WHITESPACE` regex replaces the per-character
  allocation in the skip loop.
