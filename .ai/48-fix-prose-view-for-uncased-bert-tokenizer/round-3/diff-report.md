- Round: 3
- Commits: 6 (17802c1..0523c7b)

## Deviations from the plan

- S4 (amended): the `hello world` fixture was mislabeled as BERT in the
  plan — its tokens carry a leading space, which is the GPT-2 BPE
  decode convention. It is now a `gpt2` fixture (BERT's whole-sequence
  decode inserts the space, so `world` starts at 6, which the round-2
  e2e had accepted only via the removed whitespace-skip rule).
- S4 (amended): the noised-state assertion allows a WordPiece
  continuation to render with a `##` prefix when its predecessor was
  masked — it then becomes the first visible piece, and the
  whole-sequence decode keeps `##` on the first token (the very rule
  this round encodes). The test title also gained the fixture input to
  avoid a duplicate-title Playwright error after adding fixtures.
- S1: two of the plan's new tests needed vocab corrections to be
  faithful: continuations use `##yp`/`##hen` (plan showed `hen`), and
  the GPT-2 whole-sequence decode is plain concatenation (no separator).

## Known limitations and residual risk

- The first-visible-continuation rule pins transformers.js's
  `WordPieceDecoder` (`i !== 0`); a transformers.js change could alter
  it, but the unit tests would catch that.
- The differential stub models no punctuation cleanup; that path is
  covered only by the hand-picked `hello, world` case (explicit
  no-change decision, R2-N8).
- `wordPiece` is now required `TokenizerInfo` metadata; external
  constructors of `TokenizerInfo` (none in-repo) would need updating.

## Not exercised

- The e2e tokenizer weights download requires network access; e2e is
  local-only and not in CI (pre-existing).
- `vi.fn` spy assertions run only under vitest's node environment; the
  mask-skip `continue` branch itself is engine code exercised via the
  differential, not a dedicated unit test of the branch.

## Verification

- Final `npm run test`: 45 files, 534 tests, all passing.
- `npm run e2e`: 7 passed (both BERT fixtures, GPT-2 `## heading` and
  `hello world` fixtures, smoke specs).
- Last slice-check: `ok check / lint / format / test`, within budget.
