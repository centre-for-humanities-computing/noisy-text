# Plan — #76 fix round: review findings R1-N1 … R1-N5

- Round: 2
- Addresses: R1-N1, R1-N2, R1-N3, R1-N4, R1-N5
- Slices: 5
- Estimated size: 135 changed lines

## Goal and context

Round 1 was reviewed at commit `2c882e9` with verdict `fix-and-recheck` and no
blockers. All acceptance criteria pass; the open findings are one documentation
over-claim and four test-quality gaps. This round closes each finding with a
regression test and the corresponding fix in the same slice. No behaviour
visible to the app changes, and the version is not bumped again (one bump per
issue, already done in round 1).

## Slices

### S1 — correct the documented round-trip contract (R1-N1)

- Kind: behavioral
- Budget: ≤45 changed lines (estimate 35)
- Files: `src/lib/tokenizers/word.ts` (modify, decode doc comment) — replace
  the circular "only text that satisfies the spacing rules above" sentence with
  the actual condition: the round trip holds only when the input already
  contains a space wherever `needsSpace` would insert one, i.e. no closing mark
  immediately followed by a letter (`a,b`), no letter immediately followed by
  an opening mark (`a(b`), and no standalone joiner adjacent to a word
  (`’tis`). `src/lib/tokenizers/README.md` (modify) — the Round-trip limits
  bullet gets the same wording and the three cases.
- Tests: `src/lib/tokenizers/word.test.ts` (modify) — a regression test that
  pins the documented limits: `’tis` → `’ tis`, `a,b` → `a, b`, `a(b` → `a (b`,
  each asserted not to equal the normalized input; plus one positively spaced
  case that does round-trip.
- Covers: the contract statement for AC1.
- Commit: `docs(#76): correct the word tokenizer round-trip contract`
- Reviewer note: the test and both comments must state the same condition.

### S2 — pin each vocabulary rejection reason (R1-N2)

- Kind: behavioral
- Budget: ≤40 changed lines (estimate 30)
- Files: `src/lib/tokenizers/word-vocab.test.ts` (modify) — change
  `rejects(value)` to `rejects(value, reason)` and assert
  `toThrow('parseWordVocab: ' + reason)`; supply the distinctive reason for at
  least one case per validation path (non-object, version, source, license,
  words array, words entry, whitespace, duplicate word, ranks array, ranks
  length, rank type, rank range, duplicate rank).
- Tests: the modified suite is the regression test.
- Covers: the review requirement that diagnostics are path-specific.
- Commit: `test(#76): pin word vocab rejection reasons`
- Reviewer note: no rejection case may fall back to a prefix-only assertion.

### S3 — decouple rank ordering from reverse sorting (R1-N3)

- Kind: behavioral
- Budget: ≤25 changed lines (estimate 12)
- Files: `src/lib/tokenizers/word-vocab.test.ts` (modify) — change `valid()`
  to a permutation that is neither input order nor lexicographic, e.g.
  `words: ['b', 'a', 'c']`, `ranks: [2, 0, 1]` expecting `['a', 'c', 'b']`;
  keep the extra-fields and single-word cases consistent; add a second
  differently paired case.
- Tests: the modified fixture plus the second case.
- Covers: rank ordering as the parser's only output side effect.
- Commit: `test(#76): use a non-reverse-sort rank fixture`
- Reviewer note: an implementation that returns a reverse sort must fail.

### S4 — test every decode punctuation mark against a literal string (R1-N4)

- Kind: behavioral
- Budget: ≤45 changed lines (estimate 40)
- Files: `src/lib/tokenizers/word.test.ts` (modify) — add a table-driven test
  with a literal expected string per mark in both positions: each closing mark
  after a word (`word.`, `word;`, … including straight `'` and `"`), each
  opening mark before a word (`(word`, …), and the joiner/spacing edge cases.
  Keep `naiveDecode` for the randomized ids loop only.
- Tests: the table itself is the regression test.
- Covers: the documented decode spacing contract.
- Commit: `test(#76): cover every decode punctuation mark`
- Reviewer note: expected strings must be literals, not derived from
  `CLOSING_PUNCTUATION` / `OPENING_PUNCTUATION`.

### S5 — reject empty static words (R1-N5)

- Kind: behavioral
- Budget: ≤25 changed lines (estimate 18)
- Files: `src/lib/tokenizers/word.ts` (modify, `createWordTokenizer` static-map
  loop) — reject an empty-string word with
  `createWordTokenizer: word at index <i> must not be empty`, before inserting
  it into the static map.
- Tests: `src/lib/tokenizers/word.test.ts` (modify) — assert
  `createWordTokenizer(INFO, [''])` throws, and that a vocabulary containing an
  empty entry in a later position throws with that index.
- Covers: preventing a static id that `decode` silently erases.
- Commit: `fix(#76): reject empty static words`
- Reviewer note: the error must be thrown at construction, not at encode.

## Findings and actions

- **R1-N1** → S1: replace the circular round-trip sentence in `word.ts` and
  `README.md` with the exact spacing condition, and pin the three repro cases
  in a new test.
- **R1-N2** → S2: make `rejects()` assert the full, path-specific reason.
- **R1-N3** → S3: use a rank permutation that is neither input nor reverse
  lexicographic order, plus a second pairing.
- **R1-N4** → S4: add a literal table-driven punctuation test so the decode
  sets are not only mirrored by the naive reference.
- **R1-N5** → S5: reject empty static words in `createWordTokenizer` and test
  both the only-entry and later-index cases.

## Verification

- Per slice: `node scripts/slice-check.mjs --budget <slice budget>` (check →
  lint → format → test, stages, reports changed lines; exit 2 means split).
- Focused loop: `npx vitest run src/lib/tokenizers/word.test.ts` and
  `npx vitest run src/lib/tokenizers/word-vocab.test.ts`.
- Before pushing: `npm run test`, `npx prettier --check .`. No `## Smoke steps`
  section: no user-visible behaviour and no e2e changes.
