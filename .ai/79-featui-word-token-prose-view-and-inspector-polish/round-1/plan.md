# Issue #79 — word-token prose view and inspector polish

- Round: 1
- Addresses: none (initial plan)
- Slices: 5
- Estimated size: ~495 changed lines

## Goal and acceptance criteria

Make the `words` tokenizer read correctly in the prose view and the inspector:
multi-character words, punctuation, contractions and newlines each get a
hover span; OOV words keep their text in chips, prose and graph labels; and the
picker/status copy accurately describes the append-only OOV model. The
rendering approach and tokenizer semantics stay unchanged.

- AC1: every visible word token, punctuation token and newline has a hover
  span in prose; only the join spaces and newlines are plain gaps.
- AC2: no double-highlighting or drift after substitution (span alignment
  holds across steps).
- AC3: OOV words are hoverable and correctly labelled in chips, prose and
  graphs.
- AC4: `check`, `lint`, `format`, `test` and `npm run e2e` pass.

Branch prep is complete: the session is on
`79-featui-word-token-prose-view-and-inspector-polish` and `.ai/` has no round
directory for it, so this is round 1.

## Slices

### S1 — Lock word-token character spans with unit and seeded differential tests

- Kind: behavioral
- Budget: ≤400 changed lines (estimate ~200)
- Files: `src/lib/engine/diff.test.ts` (modify) — add a
  `describe('word-tokenizer span alignment')` block importing
  `createWordTokenizer` from `../tokenizers/word.js` with a tiny static
  vocabulary (`the`, `a`, `quick`, `brown`, `cat`) and no production code
  change. Hand cases: `Hello, world!` (attached punctuation), `Don't stop.`
  (contraction, one token, case preserved), `the cat\n\njumps` (newline
  runs), `the the the` (repeated words), and `a,b\n c  d` whose decode is
  `a, b\nc d` — assert the inserted join space at index 2 has no span while the
  `\n` token has one. Add one mask case: encode `the cat`, replace the middle
  space id with the sentinel, and assert the filtered text `the cat` keeps
  `the` at 0–3 and `cat` at 4–7 with a plain gap at 3. Add a seeded test
  (`seedrandom.alea('word-token-spans' + '\0')`, 200 cases) that builds random
  text from words, punctuation, spaces, newlines and OOV words, encodes it,
  randomly replaces 0–3 ids with the sentinel, and compares
  `allTokenCharSpans` against a naive reference that computes each survivor's
  `end` as `tok.decode(survivorPrefix).length` and `start` as
  `end - tokenText.length`. `src/lib/engine/diff.ts` (modify only if a test
  fails) — no signature change; a fix must stay within this slice, update the
  matching mapping comment, and be noted in the commit body. The expected
  outcome is tests only.
- Tests: `src/lib/engine/diff.test.ts` — the cases above assert
  `text.slice(start, end) === piece text`, spans are sorted and
  non-overlapping, mask positions are absent, `tokenId`/`index` survive, and
  OOV ids are preserved.
- Covers: AC1, AC2
- Commit: `test(#79): cover word-token prose span alignment`
- Reviewer note: convince yourself the seeded reference cannot pass if
  `alignTokenPieces` summed isolated decode lengths instead of scanning the
  decoded text, and that the generator actually produces punctuation,
  newlines, repeated words and masks.

### S2 — Polish the word-card copy and the status count format

- Kind: behavioral
- Budget: ≤400 changed lines (estimate ~65)
- Files: `src/lib/format.ts` (create) — `export function formatCount(n: number):
  string` returning locale-independent space-separated thousands
  (`50 000`), implemented with a regex rather than `toLocaleString`.
  `src/lib/format.test.ts` (create) — `0`, `999`, `1 000`, `50 000`,
  `1 234 567` and a no-comma assertion.
  `src/routes/+page.svelte` (modify) — import `formatCount`; status text uses
  `Vocab: ${formatCount(encoded.vocabSize)}` and the OOV suffix becomes
  ` (+${encoded.vocabSize - t.vocabSize} OOV)` (drop `seen`; the number is
  still the whole append-only table).
  `src/lib/tokenizers/registry.ts` (modify) — words card `label` becomes
  `'Word vocabulary (50 000)'`; `gloss` mentions punctuation and newline
  tokens; `tooltip.text` gains the sentence that every punctuation mark and
  newline is a separate token. Keep `plainName: 'Whole words'` and the
  existing `$K$` / $K_{\text{eff}}$ math line.
  `src/lib/tokenizers/registry.test.ts` (modify) — update the expected label.
  `e2e/word-tokenizer.spec.ts` and `e2e/glove-word-vectors.spec.ts` (modify) —
  change `(+2 OOV seen)` / `(+3 OOV seen)` to `(+2 OOV)` / `(+3 OOV)` and
  reword the comment explaining that the count is the whole table.
- Tests: `src/lib/format.test.ts` proves the 50 000 rendering the e2e fixture
  (40 words) cannot exercise; updated e2e expectations keep the suite honest.
- Covers: AC3, AC4
- Commit: `feat(#79): polish word-token vocab copy and status count`
- Reviewer note: check the status number keeps its meaning (table size, not
  new entries) and that `formatCount` never depends on the host locale.

### S3 — Document word-token prose spans and chip glyphs

- Kind: mechanical
- Budget: ≤150 changed lines (estimate ~30)
- Files: `DESIGN.md` (modify) — add one §10.2 bullet after the WordPiece
  bullet: word tokens need no special casing because each word, punctuation
  mark and newline is its own token, so the isolated decode matches at the
  cursor; space tokens keep spans, and only spaces inserted by `decode`
  (e.g. `a,b` → `a, b`) stay plain gaps; mask sentinels are skipped, so
  surviving text may contain orphan spaces. Mention that words keep their
  original case.
  `src/lib/tokenizers/README.md` (modify) — add one Notes bullet: word pieces
  align exactly, `decode`-inserted spaces are unhighlighted, and chips render
  raw token text with `␣`, `→`, `↵` substitutions only.
- Tests: none (documentation only).
- Covers: AC1, AC3
- Commit: `docs(#79): document word-token prose spans and chip glyphs`
- Reviewer note: this slice must only describe shipped behavior; no claim
  about a new rendering approach.

### S4 — Prove word-token prose, chips and mask scrubbing end to end

- Kind: behavioral
- Budget: ≤400 changed lines (estimate ~200)
- Files: `src/lib/components/TokenChips.svelte` (modify) — add
  `data-testid="token-chip"` and `data-token-id={ids[i]}` to each chip; keep
  `title="id: …"` so existing specs still pass.
  `e2e/word-tokenizer-prose.spec.ts` (create) — route
  `**/word-vocab-50k.json` to `e2e/fixtures/word-vocab/word-vocab-50k.json`;
  fill `input-text` with `the quick,Don't stop.\nthe brown fox` **before**
  selecting `tokenizer-words` (so the default passage does not populate the
  append-only OOV table), then wait for `data-trajectory-status="ready"`.
  Test 1 asserts prose equals `the quick, Don't stop.\nthe brown fox`, the 14
  hardcoded `[start, end)` spans (`,` at 9–10, `Don't` at 11–16, `\n` at
  22–23), that the inserted space at index 10 is a plain gap, and that every
  span slice equals its token text. Test 2 switches to the `Tokens` radio and
  asserts `token-chip[aria-label="token ,"]`,
  `token-chip[aria-label="token ↵"]` and
  `token-chip[aria-label="token Don't"]` (case preserved), plus hovering the
  `fox` chip shows `fox` in the tooltip. Test 3 selects `strategy-absorbing`,
  scrubs `time-slider` to a partly masked step and asserts prose contains no
  `[MASK]` and every surviving span still slices to the text recorded for its
  `token-id` at `t = 0` with sorted, non-overlapping spans; then scrubs to
  `max`, hovers a `token-chip[aria-label="token [MASK]"]` and asserts the
  tooltip shows `[MASK]` graph labels.
- Tests: the spec itself; `data-testid`s above must exist.
- Covers: AC1, AC2, AC3, AC4
- Commit: `feat(#79): add word-token prose e2e coverage`
- Reviewer note: confirm the hardcoded spans come from the expected decode,
  not from the app's span data, and that the scrub test would fail on drift or
  double-highlighting; note that a masked position has no prose span, so the
  mask label is proved through the chip hover.

### S5 — Bump the package version

- Kind: mechanical
- Budget: ≤150 changed lines (estimate ~2)
- Files: `package.json` (modify) — `1.10.0` → `1.11.0` (feat → minor).
- Tests: none.
- Covers: AC4
- Commit: `chore(#79): bump version to 1.11.0`
- Reviewer note: the bump is once per issue and lands last in round 1.

## Coverage

- AC1: S1 hand cases and seeded test prove every non-mask word, punctuation
  and newline token gets a span and that a `decode`-inserted space is a gap;
  S4 test 1 repeats the proof on the real page (punctuation, contraction,
  newline, OOV word). Proved by `npm run test` and `npm run e2e`.
- AC2: S1's random mask-sentinel cases assert monotonic, non-overlapping
  surviving spans; S4 test 3 scrubs an absorbing trajectory and re-checks
  every survivor. Proved by `npm run test` and `npm run e2e`.
- AC3: S4 tests 2–3 assert chip glyphs, preserved case, OOV hover text and
  `[MASK]` graph labels; the existing `src/lib/workers/token-label.test.ts`
  continues to pin the OOV-first/mask-first label order. Proved by
  `npm run test` and `npm run e2e`.
- AC4: S2's unit test covers the 50 000 status format; every slice runs
  `slice-check` and the round closes with `npm run test`, `npm run build` and
  `npm run e2e`.

## Smoke steps

Only the status-copy change is visible; prose/chip behavior already exists but
is newly covered. These steps are encoded in
`e2e/word-tokenizer-prose.spec.ts` in S4.

- Route `**/word-vocab-50k.json` to
  `e2e/fixtures/word-vocab/word-vocab-50k.json`, open `/`, fill `input-text`
  with `the quick,Don't stop.\nthe brown fox`, select `tokenizer-words`, click
  `noise-button` → `output` shows that prose with an inserted space after the
  comma and `app-status` reaches `data-trajectory-status="ready"`.
- Hover the `prose-token` spans for `,`, `Don't` and the newline → each has the
  expected `data-start`/`data-end` slice and shows a `role="tooltip"` graph.
- Switch to the `Tokens` radio → `token-chip` elements with
  `aria-label="token ,"` and `aria-label="token ↵"` are visible, the `Don't`
  chip keeps its capital D, and the `fox` chip hover shows `fox`.
- Select `strategy-absorbing`, scrub to a partly masked step → prose omits
  masked words without `[MASK]` and surviving spans stay aligned; scrub to
  `max` and hover a `[MASK]` chip → the tooltip shows `[MASK]` nodes.
- Check `app-status` → it shows `Word vocabulary (50 000) · Vocab: 47
  (+7 OOV)`; the space-separated 50 000 form is covered by the `formatCount`
  unit test because the fixture vocabulary has only 40 words.

## Verification

Per slice, in order:

- `node scripts/slice-check.mjs --budget 400` for S1, S2 and S4;
  `--budget 150` for S3 and S5. The script runs `npm run check`, `npm run
  lint`, `npm run format` and `npm run test`, stages changes and reports the
  changed-line count; exit 2 means split the slice.
- Commit the staged slice with the planned subject and `Slice: S<k>/5` /
  `Kind: <behavioral|mechanical>` trailers plus a 3–5 line body.

Per round, before pushing:

- `npm run test`
- `npm run build`
- `npx playwright install chromium` (first time only)
- `npm run e2e`

## Edge cases

- The word tokenizer's decode is not a character-preserving round trip:
  digits and unspaced neutral punctuation gain spaces, so `a,b` renders as
  `a, b`. Prose must equal `tok.decode(non-mask ids)`, not the raw input; the
  inserted separator is deliberately an unhighlighted gap.
- A word token is a maximal letter run with internal `'`, `’` or `-`, so
  `Don't` is one token and keeps its capital D everywhere.
- Spaces and newlines are ordinary tokens here, so they keep spans too;
  `TokenChips` only substitutes `␣`, `→`, `↵` for display.
- Masks are invisible in prose. Removing a mask can leave an orphan `' '`
  token at an edge or a double space; this is expected decode output and is
  out of scope. A currently masked position therefore has no prose span; the
  `[MASK]` label is inspected through the chip hover.
- `+n OOV` counts the whole append-only table (all OOV seen by the tokenizer
  instance), not entries added by the current input; dropping `seen` must not
  change the number.
- OOV labelling already works through `tokenLabel` (OOV table before `#id`,
  sentinel first) and `union-graph`; do not change the `[MASK]` text.

## Risks

- S1 is tests only in the expected path; if it uncovers a real misalignment,
  the fix lands in S1 and still fits the 400-line budget with ~200 lines of
  headroom.
- The e2e fixture has 40 words, so the 50 000 status form cannot be exercised
  end to end; the unit test is authoritative.
- E2E is local-only and not in CI; the first run downloads Chromium and the
  whole round's e2e must be run before pushing.
- Hardcoded OOV ids are avoided in the new spec; select by aria-label and
  token text so fixture or OOV-order changes do not cause false failures.
- `DESIGN.md` §4.1 still describes the superseded character-diff approach;
  bringing it in line with §10.2 is a documentation follow-up, not this issue.

## Out of scope

- Changing the prose rendering approach (DESIGN §4.1 versus §10.2), adding UI
  controls, casing flags or typography changes.
- Tokenizer segmentation, normalization, decoding or vocabulary changes.
- Worker protocol, cache-key or trajectory sampling changes.
- Rewriting the stale DESIGN §4.1 prose-diff description.

## Open blocking questions

- None.
