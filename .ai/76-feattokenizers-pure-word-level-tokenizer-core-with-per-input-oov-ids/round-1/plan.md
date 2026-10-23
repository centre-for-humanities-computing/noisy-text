# Plan — #76 pure word-level tokenizer core with per-input OOV ids

- Round: 1
- Addresses: none (initial plan)
- Slices: 6
- Estimated size: 750 changed lines

## Goal and acceptance criteria

- **Goal:** add a pure word-level tokenizer core and its vocabulary parser under
  `src/lib/tokenizers/`, plus the `encode` return-shape change that lets a
  tokenizer report an effective vocabulary size. Nothing is registered in the
  picker; the app's visible behaviour is unchanged.
- **AC1:** `decode(encode(t).ids)` equals the normalized `t` for multi-paragraph
  prose with punctuation, contractions and capitals.
- **AC2:** OOV words (unknown, capitalized, accented, hyphenated) decode
  verbatim, reuse their id on re-encode, and `encode` is idempotent.
- **AC3:** a seeded randomized test compares segmentation and OOV allocation
  against a naive reference implementation on at least 500 generated strings.
- **AC4:** for every token, `decode([id])` appears verbatim and in order inside
  the whole-sequence decode (prose-alignment precondition), punctuation and
  newlines included.
- **AC5:** HF tokenizers satisfy
  `encode(...).vocabSize === tok.vocabSize`, and the app is unchanged.

## Slices

### S1 — `encode` returns ids plus the effective vocabulary size

- Kind: behavioral
- Budget: ≤60 changed lines (estimate 35)
- Files: `src/lib/tokenizers/types.ts` (modify) — add
  `export interface EncodedText { ids: Int32Array; vocabSize: number }` and
  change `Tokenizer.encode(text: string): EncodedText`; document that
  `Tokenizer.vocabSize` is the static size $K$ (ids $0 \ldots K-1$),
  `EncodedText.vocabSize` is the effective size
  $K_{\text{eff}} = K + |\text{OOV}|$, and the mask sentinel is
  $K_{\text{eff}}$, and that the object return makes stale call sites a
  compile error; `src/lib/tokenizers/hf-tokenizer.ts` (modify) — return
  `{ ids: Int32Array.from(encoded), vocabSize }` (here $K_{\text{eff}} = K$),
  no other behaviour change; `src/routes/+page.svelte` (modify, ~156-162) —
  destructure `const { ids } = t.encode(text);` and keep `tok.vocabSize` in
  `_renderTokens`, `decodedText` and the worker payloads for now.
- Tests: none new. `npm run check` is the test: every stale call site becomes a
  compile error. No HF unit test exists today (the adapter needs a model
  download), so AC5 rests on the compiler and the unchanged page path.
- Covers: AC5; exposes `.ids` for AC1 and AC2.
- Commit: `refactor(#76): return ids and effective vocab size from encode`
- Reviewer note: confirm `src/routes/+page.svelte:159` is the only app call
  site, that no worker calls `encode`, and that the page still uses static
  `tok.vocabSize` for the sentinel.

### S2 — validate a static word vocabulary file

- Kind: behavioral
- Budget: ≤200 changed lines (estimate 170)
- Files: `src/lib/tokenizers/word-vocab.ts` (create) — export
  `function parseWordVocab(value: unknown): readonly string[]`, taking an
  already-parsed JSON value (slice B will call
  `parseWordVocab(JSON.parse(text))`); validate the object
  `{ version, source, license, words, ranks }`: `version` a number,
  `source`/`license` non-empty strings, `words` non-empty unique strings with
  no whitespace (`/\s/u`), `ranks` integers of the same length as `words` and a
  permutation of $0 \ldots n-1$; `ranks[i]` is the rank of `words[i]`; return
  the words ordered by ascending rank. Throw
  `Error('parseWordVocab: <reason>')` on the first violation. Pure: no fetch,
  no shared state, does not mutate the input.
- Tests: `src/lib/tokenizers/word-vocab.test.ts` (create) — valid object is
  reordered by rank; rejects non-object, `null`, array, missing/wrong-typed
  `version`/`source`/`license`, duplicate word, empty word, word containing
  whitespace, non-string word, ranks of wrong length, duplicate rank, gap,
  negative rank, non-integer rank. Unknown extra fields are ignored.
- Covers: supports AC1 and AC2 by supplying the static $0 \ldots K-1$ ids.
- Commit: `feat(#76): parse and validate word vocab files`
- Reviewer note: check that every rejection path throws a specific message and
  that output order comes from `ranks`, not from input order.

### S3 — normalize prose and split it into word and punctuation tokens

- Kind: behavioral
- Budget: ≤250 changed lines (estimate 200)
- Files: `src/lib/tokenizers/word.ts` (create) — export
  `function normalizeWordText(text: string): string`: replace `\r\n` and `\r`
  with `\n`, then for each line trim leading/trailing spaces and tabs and
  collapse internal runs of spaces/tabs to one space, keeping every `\n`;
  export `function segmentWordText(normalized: string): string[]`: scan
  left-to-right with `WORD_RE = /[\p{L}]+(?:['’\-][\p{L}]+)*/gu` — each match is
  one token verbatim (case preserved, internal joiners kept); every other code
  point in the gaps is its own token via `Array.from` (so astral characters are
  never split), and `\n` is a token. Use `matchAll` (fresh regex state per
  call) and a cursor over the input so no character is dropped.
- Tests: `src/lib/tokenizers/word.test.ts` (create) — CRLF/CR conversion,
  per-line trimming, space/tab collapse, newlines preserved; segmentation of
  `don't`, `well-known`, punctuation, consecutive punctuation, newline, digits,
  emoji, capitalized words, and leading/trailing joiners as standalone tokens;
  seeded randomized differential test against a naive reference implementation
  on at least 500 generated strings. The naive reference scans
  `Array.from(normalized)` with `/\p{L}/u`, treating `'`, `’` and `-` as
  joiners only between two letters. Use
  `seedrandom.alea('word-segment' + '\0')`, a generator composing fragments
  (known/unknown/capitalized/accented/hyphenated words, punctuation, space,
  tab, newline, CRLF, digits, emoji), and an assertion message that echoes the
  case index.
- Covers: AC1 and AC2 (tokenization precondition); the segmentation half of
  AC3.
- Commit: `feat(#76): normalize and segment word-level text`
- Reviewer note: convince yourself the regex plus gap scan is lossless, and
  that joiners at a word boundary become standalone tokens rather than being
  absorbed.

### S4 — create the tokenizer over a static vocab plus per-instance OOV ids

- Kind: behavioral
- Budget: ≤400 changed lines (estimate 300)
- Files: `src/lib/tokenizers/word.ts` (modify) — export
  `function createWordTokenizer(info: TokenizerInfo, words: readonly string[]): Tokenizer`;
  reject an empty or duplicate-containing `words` array; static ids are
  `0 \ldots K-1` with `K = words.length`; `encode` normalizes, segments, looks
  each token up in a static map and otherwise allocates from an append-only
  per-instance OOV map in first-seen order with ids `K, K+1, \ldots`, returning
  `{ ids: Int32Array, vocabSize: K + oovMap.size }`; `idsToTokens` inverts the
  static and OOV tables and returns `''` for out-of-range ids (the page
  replaces sentinel mask ids before calling); `decode` concatenates tokens with
  one space except: no space adjacent to a newline token (which emits `\n`), no
  space before a token in `CLOSING_PUNCTUATION`
  (`. , ; : ! ? ) ] } % … ” ’ » ›` plus straight `'` and `"`), and no space
  after a token in `OPENING_PUNCTUATION`
  (`( [ { “ ‘ « ‹` plus straight `'` and `"`); first token has no leading
  space. Document the resulting round-trip limits (digits, `/_@#` and unspaced
  neutral punctuation are spaced on decode; straight quotes are ambiguous) in
  a comment above `decode`.
- Tests: `src/lib/tokenizers/word.test.ts` (modify) — `encode` returns an
  `EncodedText`; `vocabSize` is $K$ before OOV and grows by the number of
  distinct OOV tokens; OOV ids are first-seen and reused. AC1: a multi-paragraph
  prose fixture (punctuation, contractions, capitals, CRLF) round-trips to
  `normalizeWordText(text)`. AC2: unknown, capitalized, accented and hyphenated
  words decode verbatim, re-encode to the same ids, and a second `encode` of
  the same text is byte-identical. AC4: walk the whole-sequence decode with a
  cursor and assert each `decode([id])` is found at or after it. Randomized
  differential test for OOV allocation and full ids against a naive reference
  (static map plus a first-seen counter) on at least 500 generated strings,
  reusing the S3 generator with `seedrandom.alea('word-oov' + '\0')`, also
  comparing the decoded text.
- Covers: AC1, AC2, the OOV half of AC3, AC4.
- Commit: `feat(#76): create word tokenizer with per-input OOV ids`
- Reviewer note: confirm OOV allocation order is deterministic and
  append-only, that `vocabSize` is captured after encoding the text, and that
  the decode spacing sets match the documented rule.

### S5 — document the word tokenizer contract

- Kind: mechanical
- Budget: ≤150 changed lines (estimate 40)
- Files: `src/lib/tokenizers/README.md` (modify) — add a "Word tokenizer (not
  yet registered)" section covering: static $K$, effective
  $K_{\text{eff}} = K + |\text{OOV}|$, append-only first-seen OOV ids, mask
  sentinel $K_{\text{eff}}$, normalization and segmentation rules,
  `parseWordVocab`'s schema and validation, the decode spacing rule, and its
  known round-trip limits.
- Tests: none.
- Covers: documentation for AC1, AC2 and AC5.
- Commit: `docs(#76): document the word tokenizer contract`
- Reviewer note: every documented rule must match the code in `word.ts` and
  `word-vocab.ts`, especially the decode limits.

### S6 — bump the version

- Kind: mechanical
- Budget: ≤10 changed lines (estimate 2)
- Files: `package.json` (modify) — `1.7.0` → `1.8.0` (highest commit type is
  `feat`, so minor); `package-lock.json` is not edited.
- Tests: none.
- Covers: release bookkeeping for all acceptance criteria.
- Commit: `chore(#76): bump version to 1.8.0`
- Reviewer note: only the version line changes.

## Coverage

- **AC1** — S3 produces the normalized tokens; S4's round-trip test asserts
  `decode(encode(t).ids) === normalizeWordText(t)` on a multi-paragraph
  fixture.
- **AC2** — S4's OOV tests cover unknown, capitalized, accented and hyphenated
  words, id reuse on re-encode, and encode idempotence.
- **AC3** — S3's seeded segmentation differential and S4's seeded OOV/id
  differential each run at least 500 generated strings against naive
  references.
- **AC4** — S4's cursor walk asserts every `decode([id])` appears verbatim and
  in order, including punctuation and newline tokens.
- **AC5** — S1 returns `{ ids, vocabSize }` from the HF adapter with
  `vocabSize` unchanged, and the page destructures `.ids`; `npm run check`
  proves every call site compiles and `npm run test` proves existing behaviour.
  No network-backed HF test is added, matching the current suite.

## Verification

- Per slice: `node scripts/slice-check.mjs --budget <slice budget>` (it runs
  `npm run check` → `npm run lint` → `npx prettier --write .`-style format step
  → `npm run test`, stages everything except `.ai/`, and exits 2 when changed
  lines exceed 1.25× the budget). Commit the slice immediately afterwards with
  the `Slice: S<k>/6` and `Kind:` trailers; do not start the next slice with
  staged files.
- Focused loop while developing S2–S4:
  `npx vitest run src/lib/tokenizers/word-vocab.test.ts` and
  `npx vitest run src/lib/tokenizers/word.test.ts`.
- Per round, before pushing: `npm run test` once more and
  `npx prettier --check .`. `npm run e2e` is not required: this round changes
  no user-visible behaviour and has no `## Smoke steps` section.
- If a slice lands between 1.0× and 1.25× its budget, split it into `S<k>a` and
  `S<k>b` per the repo slicing rules rather than pushing the oversize commit.

## Edge cases, risks, out-of-scope, open questions

- **Edge: digits and neutral punctuation.** `\p{L}`-only words mean digits are
  one token per character and decode inserts spaces between them; `/`, `_`,
  `@` and `#` behave the same. AC1's fixture avoids these; the limitation is
  documented in S4/S5.
- **Edge: straight quotes.** `'` and `"` are in both punctuation sets, so
  `word "quote"` decodes as `word"quote"`. Curly quotes are unambiguous. This
  is a documented heuristic, not a bug in the AC1 fixture.
- **Edge: combining marks.** `\p{L}` excludes combining marks, so decomposed
  accents split into two tokens; precomposed accented letters are fine.
- **Edge: whitespace-only input** normalizes to an empty string (or preserves
  its newlines) and encodes to an empty id array; `decode([])` is `''`.
- **Edge: OOV memory** grows monotonically per tokenizer instance. Acceptable
  for a browser playground and documented; no eviction in this slice.
- **Risk: interface churn.** The `encode` shape change touches a public
  interface, but reconnaissance found exactly one app call site
  (`src/routes/+page.svelte:159`) and no worker use. The compiler enforces it.
- **Risk: S4 size.** The estimate is 300 lines; if implementation plus tests
  exceed 400, split into S4a (encode/OOV/`idsToTokens`) and S4b (`decode` plus
  round-trip and alignment tests) with matching commit trailers.
- **Risk: decode fidelity.** The spacing heuristic is not a general
  detokenizer; the README states exactly which inputs round-trip.
- **Risk: AC5 coverage.** The HF adapter has no unit test because it downloads
  a model; the shape guarantee is compile-time plus existing suite coverage.
- **Out of scope:** registry entry and picker card, model/vocab fetching,
  vectors, prose spans and UI, per-token case flags, contraction splitting,
  `index.ts` barrel exports, and switching the page's mask sentinel to
  `encoded.vocabSize` — all deferred to slices B–D of #53.
- **Open blocking questions:** none.
