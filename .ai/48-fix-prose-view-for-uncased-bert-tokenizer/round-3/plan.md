- Round: 3
- Addresses: R2-B1, R2-N1, R2-N2, R2-N3, R2-N4, R2-N5, R2-N6, R2-N7, R2-N8, R2-N9, R2-N10, R2-N11, R2-N12, R2-N13
- Slices: 5
- Estimated size: ~445 changed lines

## Goal and acceptance criteria

Round 2 fixed the WordPiece `##` misalignment by stripping a leading `##`
unconditionally, which regressed GPT-2 tokens whose decoded text starts with
`##`, and it still misaligns a first-visible WordPiece continuation because
transformers.js keeps `##` on the first token of a whole-sequence decode. The
differential tests added in round 2 also cannot fail when the mask-skip or
whitespace-skip rules are removed. This round makes normalization tokenizer-
and position-aware, makes the differential tests load-bearing, and tightens the
browser test.

- AC1: With `bert-base-uncased` in prose view, every token highlight covers
  exactly that token's characters in the decoded prose text, including a
  continuation token at the first visible position.
- AC2: The misalignment does not accumulate: for an unmasked sequence the
  final token's span ends at the end of the decoded prose.
- AC3: The GPT-2 prose view and the chips view keep working exactly as before,
  including tokens whose decoded text starts with `##` (e.g. `##`, `###`).
- AC4: The span mapping is covered by a seeded randomized differential test
  against a naive reference implementation, in addition to hand-picked cases,
  and the mask-skip path is load-bearing.

## Findings and actions

- R2-B1 — Make `##` normalization conditional on `wordPiece` and visible
  position, so GPT-2 pieces are never stripped (S1).
- R2-N1 — Keep `##` on the first visible WordPiece piece (matching the
  whole-sequence decode) and strip it only for later continuations (S1).
- R2-N2 — Rename the shadowing local `text` to `pieceText` (S1).
- R2-N3 — Factor one `decodeWord(vocab, ids)` helper used by the describe stub
  and the new tests; remove the duplicated decoders and shadowing (S1).
- R2-N4 — Qualify the U+FFFD claim in the `allTokenCharSpans` JSDoc and
  `docs/libraries.md`: only pieces whose UTF-8 bytes are split across token
  boundaries decode to U+FFFD in isolation (S5).
- R2-N5 — Spy on `decodeToken` in the mask differential and assert it is never
  called with the mask sentinel, so deleting the `continue` fails (S2).
- R2-N6 — Remove the whitespace-skip branch: it is provably equivalent to the
  `indexOf` fallback for every non-empty piece (the skipped region is all
  whitespace, so a matching piece must start at `skip`), so there is no dead
  rule left to exercise. Keep the multi-space differential cases, which now
  prove the fallback handles them (S3).
- R2-N7 — Add `alignTokenPieces('oneXtwoYone', ['one','two','one'])` expecting
  `[0,3)`, `[4,7)`, `[8,11)` so searching from 0 fails the test (S3).
- R2-N8 — Explicit no-change decision: the differential stub intentionally
  models no cleanup; add a comment that punctuation cleanup is covered by the
  hand-picked `hello, world` case, and do not claim the differential covers it
  (S3).
- R2-N9 — Give visible tokens distinct vocab ids (`BASE_ID + i`) so `tokenId`
  and `index` differ, and assert both (S2).
- R2-N10 — Wait for `data-trajectory-status="ready"` directly; drop the
  swallowed 5 s `computing` probe (S4).
- R2-N11 — Correct the scrub comment: 10% leaves every token unmasked under
  the default linear schedule and seed 42, so the loop advances in 5% steps to
  the first partial state (S4).
- R2-N12 — Put `id` inside `Fixture` and iterate `FIXTURES`; drop
  `TOKENIZER_IDS` (S4).
- R2-N13 — Scope the DESIGN.md §10.2 "lengths never sum" claim to WordPiece
  and describe the tokenizer-aware strip and the exact-then-`indexOf`
  alignment (S5).

## Slices

### S1 — Normalize `##` only for WordPiece continuations after the first visible piece

- Kind: behavioral
- Budget: ≤400 changed lines (estimated 170)
- Files: `src/lib/tokenizers/types.ts` (modify) — add
  `readonly wordPiece: boolean` to `TokenizerInfo`, documented as true when a
  continuation piece's isolated decode carries a `##` prefix that the
  whole-sequence decode drops after the first token.
  `src/lib/tokenizers/registry.ts` (modify) — set `wordPiece: false` on `gpt2`
  and `wordPiece: true` on `bert-base-uncased`.
  `src/lib/engine/diff.ts` (modify) — change the signature to
  `allTokenCharSpans(ids: Int32Array, tokenRecency: Float32Array, decodeToken: (id: number) => string, maskSentinel: number, text: string, wordPiece: boolean): TokenCharSpan[]`.
  In the piece loop compute
  `const isContinuation = wordPiece && pieces.length > 0 && raw.startsWith('##');`
  and `const pieceText = isContinuation ? raw.slice(2) : raw;`; `pieces.length`
  is the visible position because masks are filtered first. Rename the local
  `text` to `pieceText`. Update `TokenPiece.text` and the `allTokenCharSpans`
  JSDoc to state the tokenizer-aware rule.
  `src/routes/+page.svelte` (modify) — pass `tok.info.wordPiece` as the sixth
  argument to `allTokenCharSpans` (`:224-230`).
  `src/lib/tokenizers/registry.test.ts` (modify) — assert every entry has a
  boolean `wordPiece`, with `gpt2` false and `bert-base-uncased` true.
- Tests: `src/lib/engine/diff.test.ts` (modify) — factor
  `decodeWord(vocab: readonly string[], ids: readonly number[]): string`
  implementing the faithful WordPiece whole-sequence decode (first token raw,
  later `##` stripped, non-continuations space-joined), and use it for the
  describe-scope `decodeAll` and the new tests (R2-N3); rename local decoders
  so none shadows the describe-scope `decodeToken`. Add a GPT-2 regression test
  with `vocab = ['##', ' heading', '###', ' title']`, `wordPiece = false`:
  `allTokenCharSpans` over `[0,1]` with text `'## heading'` yields
  `[[0,2],[2,10]]` and token texts `['##',' heading']`; over `[2,3]` with text
  `'### title'` yields `[[0,3],[3,9]]` and `['###',' title']`. Add WordPiece
  first-visible continuation tests: `vocab = ['##yp','hen']`, ids `[0,1]`,
  text `'##yphen'`, `wordPiece = true` yields `[[0,4],[4,7]]` with indices
  `[0,1]`; ids `[99,0,1]` (mask first) yields the same spans with indices
  `[1,2]`; a piece that is exactly `##` is kept when first visible and dropped
  when later. Update every existing `allTokenCharSpans` call to pass `true`
  (WordPiece stub) or `false` (GPT-2).
- Covers: AC1, AC2, AC3
- Commit: `fix(#48): R2-B1 normalize ## per tokenizer and visible position`
- Reviewer note: Confirm the strip predicate uses the visible-position counter
  (`pieces.length`), not the original token index, and that GPT-2 pieces are
  never modified. The first-visible-continuation tests must fail against the
  round-2 unconditional strip.

### S2 — Make the mask differential fail when the mask skip is removed

- Kind: behavioral
- Budget: ≤400 changed lines (estimated 70)
- Files: `src/lib/engine/diff.test.ts` (modify) — import `vi` from `vitest`.
  In the mask differential, give every visible token a distinct id
  (`const BASE_ID = 1000; ids[i] = isMask[i] ? MASK : BASE_ID + i`) and build
  `const decodeToken = vi.fn((id: number) => (id === MASK ? '' : (rawTokens[id - BASE_ID] ?? '')))`.
  Assert `expect(decodeToken).not.toHaveBeenCalledWith(MASK)` after the run, and
  assert `s.tokenId === BASE_ID + orig` separately from `s.index === orig`.
  Pass `wordPiece = true` to `allTokenCharSpans`. Keep the existing span,
  recency, and mask-position assertions.
- Tests: same file; the assertions above are the new coverage.
- Covers: AC4
- Commit: `test(#48): R2-N5 R2-N9 make mask differential load-bearing`
- Reviewer note: Deleting `if (id === maskSentinel) continue;` must now fail
  because `decodeToken` is called with `MASK`. Check that `tokenId` and `index`
  can no longer coincide.

### S3 — Remove the redundant whitespace-skip rule and pin the cursor behaviour

- Kind: behavioral
- Budget: ≤400 changed lines (estimated 80)
- Files: `src/lib/engine/diff.ts` (modify) — delete the whitespace-skip block
  in `alignTokenPieces` (`:169-175`), leaving exact-match-at-cursor then the
  `indexOf` fallback. Update the JSDoc rules list to two rules and state why
  the fallback subsumes whitespace skipping: the region between the cursor and
  the first non-whitespace character is all whitespace, so a non-empty piece
  that matches after it matches at that first non-whitespace character, which
  `indexOf` finds from the cursor. Keep the empty-piece rule unchanged.
  `src/lib/engine/diff.test.ts` (modify) — add
  `alignTokenPieces('oneXtwoYone', pieces(['one','two','one']))` expecting
  `[{0,3},{4,7},{8,11}]`; update the stale "no whitespace to skip" comment on
  the `oneXtwoone` test; add a comment near `randomWord`/the differential that
  the stub models no cleanup, so punctuation cleanup is covered only by the
  hand-picked `hello, world` case.
- Tests: same file; the new `oneXtwoYone` case plus the retained multi-space
  differential cases.
- Covers: AC4
- Commit: `fix(#48): R2-N6 drop redundant whitespace-skip alignment rule`
- Reviewer note: Convince yourself the removed branch is equivalent to
  `indexOf` for all inputs (the equivalence argument is in the finding) and
  that `oneXtwoYone` fails if `indexOf` starts at 0. No production behaviour
  should change; the differential must stay green.

### S4 — Tighten the prose e2e waits and add a GPT-2 `##` fixture

- Kind: behavioral
- Budget: ≤400 changed lines (estimated 80)
- Files: `e2e/fix-prose-view-for-uncased-bert-tokenizer.spec.ts` (modify) — add
  `id: string` to `Fixture`, put the tokenizer id in each fixture, drop
  `TOKENIZER_IDS`, and loop over `FIXTURES` directly. Add a GPT-2 fixture
  `{ id: 'gpt2', input: '## heading', prose: '## heading', tokens: ['##', ' heading'], spans: [[0,2],[2,10]] }`.
  Rewrite `waitForReady` to wait only for
  `data-trajectory-status="ready"` with `TOKENIZER_TIMEOUT` (no swallowed
  `computing` probe). Replace the "scrub to 10%" comment with the measured
  behaviour: under the default linear schedule and seed 42, 10% leaves every
  token unmasked, so the loop advances in 5% steps to the first partial state.
- Tests: same file; `npm run e2e` runs both fixtures.
- Covers: AC1, AC2, AC3
- Commit: `test(#48): R2-N10 R2-N12 tighten prose e2e waits and fixtures`
- Reviewer note: The GPT-2 fixture must fail against the round-2
  unconditional strip (the `##` token would be dropped). Confirm removing the
  computing probe does not hide a missing recompute: the post-scrub text
  change assertion still proves the trajectory moved.

### S5 — Scope the decode and alignment documentation

- Kind: mechanical
- Budget: ≤150 changed lines (estimated 45)
- Files: `src/lib/engine/diff.ts` (modify, comments only) — qualify the
  U+FFFD sentence: some GPT-2 non-ASCII tokens (those whose UTF-8 bytes are
  split across token boundaries) decode to U+FFFD in isolation and are
  omitted; tokens that decode to a complete character align normally.
  `docs/libraries.md` (modify) — apply the same qualifier.
  `DESIGN.md` §10.2 (modify) — scope "per-token decode lengths never sum" to
  WordPiece, keep the GPT-2 sentence, and describe the tokenizer-aware strip
  (only WordPiece continuations after the first visible piece; the first
  visible continuation keeps `##` to match the whole-sequence decode) and the
  exact-then-`indexOf` alignment without the removed whitespace-skip rule.
  `src/lib/tokenizers/README.md` (modify) — document the `wordPiece` field in
  the add-a-tokenizer steps and the Notes.
- Tests: none (documentation only); `npm run check` and `npm run lint` still
  apply.
- Covers: AC1, AC3
- Commit: `docs(#48): R2-N4 R2-N13 scope decode and alignment docs`
- Reviewer note: Check that no doc still claims GPT-2 decode lengths fail to
  sum or that every non-ASCII GPT-2 token decodes to U+FFFD, and that the
  alignment description matches the post-S3 code.

## Coverage

- AC1 — S1's first-visible-continuation and `hyphenated` unit tests, and S4's
  BERT e2e exact-span assertions.
- AC2 — S1's final-span-ends-at-prose-length assertion and S4's e2e final-span
  check.
- AC3 — S1's GPT-2 `##`/`###` unit tests and S4's GPT-2 `## heading` e2e
  fixture.
- AC4 — S2's load-bearing mask differential and S3's cursor-sensitive
  `indexOf` case plus the retained seeded differential.

## Smoke steps

1. Select `tokenizer-bert-base-uncased`, fill `input-text` with
   `hyphenated hyphen`, click `noise-button` → `prose-text` shows
   `hyphenated hyphen` and the seven `prose-token` spans are
   `[0,1)`, `[1,3)`, `[3,6)`, `[6,10)`, `[11,12)`, `[12,14)`, `[14,17)`.
2. Select `tokenizer-gpt2`, fill `input-text` with `## heading`, click
   `noise-button` → the first `prose-token` is exactly `##` at `[0,2)` and the
   second is ` heading` at `[2,10)`; no token is dropped.
3. Select `strategy-absorbing`, then move `time-slider` forward in 5% steps →
   the prose changes and every surviving `prose-token` still renders its own
   token text; the last span never exceeds the prose length.
4. Repeat steps 1–3 watching the console → no `pageerror` and no console
   errors.

Required test ids: `tokenizer-bert-base-uncased`, `tokenizer-gpt2`,
`input-text`, `noise-button`, `app-status` (with `data-trajectory-status`),
`prose-text`, `prose-token` (with `data-start`, `data-end`, `data-token-id`),
`strategy-absorbing`, `time-slider`.

## Verification

- Per slice: `node scripts/slice-check.mjs --budget <slice budget>` (runs
  `npm run check` → `lint` → `format` → `test`, stages, and checks the size).
- Per round, before pushing: `npm run test` once more, then `npm run e2e`
  (install Chromium once with `npx playwright install chromium`; e2e needs
  network access for tokenizer weights).

## Edge cases, risks, and out-of-scope

- Removing the whitespace-skip branch relies on the equivalence argument in
  R2-N6. The retained multi-space differential cases and the hand-picked
  `hello world`/`hello, world` tests cover the behaviour.
- The first-visible-continuation rule encodes transformers.js's
  `WordPieceDecoder` behaviour (`i !== 0`); the faithful stub and the
  first-visible tests pin it. A future transformers.js change could alter
  this, and the unit test would catch it.
- `wordPiece` is new required registry metadata; every `TokenizerInfo` is
  built in `registry.ts`, so there are no other constructors to update.
- The e2e downloads tokenizer weights and fails offline; this is pre-existing.
- The revision estimate (~445 lines) exceeds 400. Revision rounds are exempt
  from the round-1 size gate, but the reviewer should expect five commits.
- Out of scope (unnumbered test gaps/open questions from the review): exact
  post-scrub span assertions in e2e, an offline skip, empty-input/T=0 browser
  coverage, and mocking the tokenizer network. Only the `- Open findings:`
  IDs above are addressed.

## Open blocking questions

None. The two judgment calls are R2-N6 (remove the redundant rule rather than
instrument it) and R2-N8 (document the cleanup gap rather than build a
cleanup-enabled differential stub); both are recorded above.