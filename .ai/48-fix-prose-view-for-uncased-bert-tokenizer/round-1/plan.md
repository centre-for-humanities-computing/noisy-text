- Round: 1
- Addresses: none (initial plan)
- Slices: 3
- Estimated size: 475 changed lines

## Goal

Fix the prose view for the uncased BERT tokenizer. Today every token
highlight is anchored by summing the lengths of tokens decoded in
isolation (`src/lib/engine/diff.ts:200`). HuggingFace's WordPiece decoder
inserts a space before each non-`##` piece when it decodes a whole
sequence, but a single-id decode is the first piece and gets no space, so
the summed length is short by one character per word boundary. The error
accumulates with position, which is exactly the reported symptom. The fix
derives character spans by aligning each token's decoded text to the
actual decoded prose instead of summing lengths.

## Acceptance criteria

- AC1: With `bert-base-uncased` in prose view, every token highlight
  covers exactly that token's characters in the decoded prose text.
- AC2: The misalignment does not accumulate: the final token's span ends
  at the end of the decoded prose.
- AC3: The GPT-2 prose view and the chips view keep working exactly as
  before (no regression for tokenizers whose single-token decode already
  carries its leading separator).
- AC4: The span mapping is covered by a seeded randomized differential
  test against a naive reference implementation, in addition to
  hand-picked cases.

## Slices

### S1 — Derive prose character spans by aligning each token's text to the decoded prose instead of summing isolated-token lengths

- Kind: behavioral
- Budget: 220 changed lines
- Files: `src/lib/engine/diff.ts` (modify) — add exported
  `interface TokenPiece { index: number; tokenId: number; text: string }`
  and `interface PieceSpan { start: number; end: number }`, and
  `export function alignTokenPieces(text: string, pieces: readonly TokenPiece[]): PieceSpan[]`.
  Change `allTokenCharSpans` to
  `(ids, tokenRecency, decodeToken, maskSentinel, text: string)` — same
  return type `TokenCharSpan[]`. `src/routes/+page.svelte` (modify) —
  pass the already-derived `decodedText` as the new fifth argument at
  `src/routes/+page.svelte:224`; no other UI change.
- Tests: `src/lib/engine/diff.test.ts` (modify) — update the seven
  existing `allTokenCharSpans` call sites with the new `text` argument
  (their fixtures concatenate to e.g. `'t1t2t3'`), then add
  `describe('alignTokenPieces')` with: exact concatenation;
  space-joined BERT-style pieces (`'hello world'`, pieces `hello` /
  `world` → `[0,5)` / `[6,11)`); `##` continuation (`'playing'`,
  pieces `play` / `ing` → `[0,4)` / `[4,7)`); punctuation cleanup
  (`'hello, world'`, pieces `hello` / `,` / `world` → `[0,5)` / `[5,6)` /
  `[7,12)`); GPT-2-style leading-space piece (`'hello world'`, pieces
  `hello` / ` world` → `[0,5)` / `[5,11)`); empty piece stays at the
  cursor; unexpected intervening character falls back to `indexOf`
  (`'abXcd'`, pieces `ab` / `cd` → `[0,2)` / `[3,5)`). Add a
  `describe('allTokenCharSpans (WordPiece-style decoder)')` with a stub
  whose whole-sequence decode joins non-`##` pieces with a space, and
  assert (a) span text slices equal the token text, (b) mask sentinels
  are skipped without shifting later spans, (c) recency and `index` still
  map to the original token positions. Add the seeded randomized
  differential test: build random word/punctuation sequences from pieces
  (`##` continuations, occasional mask sentinels), fix the seed with
  `seedrandom.alea('align-token-spans' + '\0')`, run ~200 cases, and
  compare `alignTokenPieces` against a naive reference that takes
  prefix-decoded lengths over the non-mask ids and adds one for each
  non-`##` piece after the first. The stub decoder used by the
  differential test must have cleanup disabled so prefix decoding is
  prefix-consistent; cleanup behaviour is covered by the hand-picked
  punctuation case.
- Covers: AC1, AC2, AC3, AC4
- Commit: `fix(#48): align prose token spans to the decoded text`
- Reviewer note: `alignTokenPieces` is the whole idea: the greedy cursor
  advances by matched text, never by summed lengths. Check that the
  whitespace-skip rule cannot move the cursor backwards and that the
  differential reference is genuinely independent (prefix-length deltas,
  not the same greedy scan).

### S2 — Add prose-span test hooks and a Playwright spec that asserts span/text alignment for BERT and GPT-2

- Kind: behavioral
- Budget: 85 changed lines
- Files: `src/lib/components/InlineTokens.svelte` (modify) — put
  `data-testid="prose-text"` on both `<p class="inline-text">` branches
  (`src/lib/components/InlineTokens.svelte:44` and `:47`) and add
  `data-testid="prose-token"`, `data-start={seg.span.start}` and
  `data-end={seg.span.end}` to the highlight `<span>` (`:52`).
  `src/lib/components/TokenizerPicker.svelte` (modify) — pass
  `testIdPrefix="tokenizer"` to `CardPicker` so options render as
  `tokenizer-gpt2` and `tokenizer-bert-base-uncased`.
  `e2e/fix-prose-view-for-uncased-bert-tokenizer.spec.ts` (create).
- Tests: `e2e/fix-prose-view-for-uncased-bert-tokenizer.spec.ts` (create)
  — one test per tokenizer in `['bert-base-uncased', 'gpt2']`: fill
  `input-text` with `'The quick brown fox jumps over the lazy dog again
  and again'`, click `tokenizer-<id>`, wait for it to be enabled and
  `aria-checked="true"`, click `noise-button`, wait for `time-slider` to
  be enabled. In `page.evaluate` on `prose-text`, read `textContent` and
  every `[data-testid="prose-token"]` with its `data-start` / `data-end`;
  assert at least four spans, spans sorted and non-overlapping, every
  `text.slice(start, end)` equals the span's own `textContent`, and
  `last.end === text.length`. Then fill the slider to half of `max` and
  re-assert the same invariant (mask tokens are dropped without shifting
  later spans).
- Covers: AC1, AC2, AC3
- Commit: `fix(#48): add prose alignment smoke test`
- Reviewer note: the test ids are inert in production; the assertion is
  the real content. Confirm the test fails on the pre-S1 mapping (spans
  drift from the second word onward) and that it still passes for GPT-2.

### S3 — Delete the dead length-summing span helper, document the decoder separator behaviour, and bump the version

- Kind: mechanical
- Budget: 170 changed lines (human-waived overrun of the 150-line
  mechanical budget; see Risks)
- Files: `src/lib/engine/diff.ts` (modify) — delete `interface CharRange`
  (`src/lib/engine/diff.ts:107`) and `export function tokenCharRanges`
  (`:136-167`); nothing outside `src/lib/engine/diff.ts` and its test
  imports them, and they carry the same invalid length-summing assumption
  that S1 fixed. `src/lib/engine/diff.test.ts` (modify) — delete the whole
  `describe('tokenCharRanges')` block (`:176-263`) and any imports or
  fixture helpers that become unused; do not touch the
  `allTokenCharSpans` or `alignTokenPieces` suites. `docs/libraries.md`
  (modify) — under the transformers section, note that `decode(ids)` joins
  pieces with separators (WordPiece inserts a space before each non-`##`
  piece) and applies `clean_up_tokenization_spaces`, so decoding a single
  id in isolation omits those separators and per-token decode lengths
  never sum to the full decoded length; character offsets must be aligned,
  not summed (see `alignTokenPieces` in `src/lib/engine/diff.ts`).
  `src/lib/tokenizers/README.md` (modify) — one bullet under Notes
  pointing at the same rule. `package.json` (modify) — `1.6.0` →
  `1.6.1` (highest commit type is `fix`).
- Tests: `src/lib/engine/diff.test.ts` — deletions only; `npm run test`
  must still pass with no skipped suite.
- Covers: none (cleanup and documentation only)
- Commit: `chore(#48): drop dead tokenCharRanges, document decode separators, bump version to 1.6.1`
- Reviewer note: skim only; confirm no remaining reference to
  `tokenCharRanges` or `CharRange` anywhere in the tree, that no other
  test case was removed, and that the note does not claim offsets come
  from the tokenizer, because transformers.js exposes none.

## Coverage

- AC1 — S1 adds the alignment function and hand-picked WordPiece cases;
  S2 proves it end-to-end in the browser for `bert-base-uncased`.
- AC2 — S1's differential test covers long sequences; S2 asserts the
  final span ends at the end of `prose-text` before and after scrubbing.
- AC3 — S1 keeps the existing `allTokenCharSpans` tests and adds a
  GPT-2-style leading-space case; S2 runs the same assertions for `gpt2`;
  chips view is untouched (only `InlineTokens.svelte` changes).
- AC4 — S1's seeded randomized differential test against prefix-length
  deltas.

## Smoke steps

- Enter `'The quick brown fox jumps over the lazy dog again and again'`,
  select `bert-base-uncased` (`tokenizer-bert-base-uncased`), click Noise
  → the prose view shows highlighted tokens under `data-testid="prose-text"`.
- Compare each `prose-token`'s `data-start`/`data-end` slice of the prose
  text with the span's own text → all equal (no drift from the second
  word onward).
- Scrub `time-slider` to half → the same invariant holds while mask
  tokens are hidden.
- Read the last `prose-token` span → `data-end` equals the prose length.
- Select `gpt2` and repeat → the invariant still holds.

Required test ids: `input-text`, `noise-button`, `time-slider`,
`tokenizer-bert-base-uncased`, `tokenizer-gpt2`, `prose-text`,
`prose-token` (plus `data-start` / `data-end` attributes).

## Verification

- Per slice: `node scripts/slice-check.mjs --budget <slice budget>`
  (runs `npm run check` → `lint` → `format` → `test`, stages, and checks
  the changed-line count; exit 2 means split the slice). For S3 only, the
  budget is human-waived: run it with `--budget 400` so the script's
  check/lint/format/test portion still gates the slice, and note the
  waiver in the commit body.
- Per round, before pushing: `npm run test` once more, then `npm run e2e`
  (the spec needs network for the tokenizer weights on first run;
  `playwright.config.ts` already allows 120 s per test).

## Edge cases

- Leading-space pieces (GPT-2 `Ġ`) must match directly at the cursor; the
  whitespace-skip branch must not double-count the space.
- `##` continuations decode without a leading space and must attach to
  the previous span.
- Punctuation is space-cleaned in the full decode (`, . ? !` and the
  apostrophe rules), so gaps are not always single spaces.
- Mask sentinels are filtered out of the decoded text; they must be
  skipped in the piece list so later spans do not shift.
- Tokens that decode to the empty string must not create spans.
- A piece that cannot be found leaves an empty span at the cursor instead
  of throwing (the prose view is a derived value and must not crash).

## Risks

- The `indexOf` fallback can in principle jump over repeated text; it is
  reached only when the whitespace-skip match fails, and the differential
  test plus the e2e assertion would expose a bad jump.
- The e2e spec downloads `bert-base-uncased` weights on first run; it is
  local-only (not in CI) and inherits the existing 120 s timeout.
- S1 changes an exported signature; the only production caller is
  `src/routes/+page.svelte:224`, updated in the same slice.
- S3 exceeds the 150-line mechanical budget by explicit human
  authorization; it is still deletion-only apart from the docs and version
  lines, and stays a single commit so it can be reviewed as one diff.

## Out of scope

- Showing the original-cased input instead of the lowercased BERT decode
  is a separate product decision.
- The chips view (`TokenChips.svelte`) uses token indices and needs no
  change.
