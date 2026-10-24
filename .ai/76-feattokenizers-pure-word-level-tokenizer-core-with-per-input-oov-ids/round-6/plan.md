# Plan — #76 fix round: review finding R5-N1

- Round: 6
- Addresses: R5-N1
- Slices: 2
- Estimated size: 40 changed lines

## Goal and context

Round 5 was reviewed at commit `0fc3098` with verdict `fix-and-recheck`, no
blockers, one open finding: the round-trip paragraph still over-claims. It now
exempts only straight quotes, so it says any other closing mark immediately
followed by a letter fails — but `’` is a closing mark and a `WORD_PATTERN`
joiner, so `Don’t` (cited two lines later as passing) and `a’b` round-trip.
Measured on the current code (`word.ts:14`, `:69-90`, `:208-213`):

- round-trip: `a’b`, `Don’t`, `a'b`, `a"b`, `word’`, `a ’ b`, `a"`, `a’`
- fail: `a,b` → `a, b`, `’b` → `’ b`, `a(b` → `a (b`, `a“b` → `a “b`,
  `a”b` → `a” b`

The blanket "other than a straight quote" exemption is therefore still false in
one direction (`’b` fails, so `’` cannot simply be excluded) and under-specified
in another (`a"b` passes even though `"` is not a joiner). This round restates
the clause in terms of "a straight quote, or the mark and letter form one word",
pins the four new cases in the limit test, and makes `README.md` and the
`decode` doc comment identical again. No runtime behaviour changes; no version
bump (revision round).

## Goal and acceptance criteria

- AC1: `decode(encode(t).ids)` equals the normalized `t` for multi-paragraph
  prose with punctuation, contractions and capitals.
- AC2: OOV words (unknown, capitalized, accented, hyphenated) decode verbatim,
  reuse their id on re-encode, and `encode` is idempotent.
- AC3: a seeded randomized test compares segmentation and OOV allocation
  against a naive reference on at least 500 generated strings.
- AC4: for every token, `decode([id])` appears verbatim and in order inside the
  whole-sequence decode, punctuation and newlines included.
- AC5: HF tokenizers satisfy `encode(...).vocabSize === tok.vocabSize`, and the
  app is unchanged.

Round-6 goal: make the documented adjacent-mark failure clause true for `’` in
both positions, and pin the newly documented cases.

## Slices

### S1 — pin the joiner and straight-quote adjacency cases in the limit test

- Kind: behavioral
- Budget: 25 changed lines (estimate 10)
- Files: `src/lib/tokenizers/word.test.ts` (modify, limit test at `:253-270`).
  In the failing `cases` array (after `:258`) add `['’b', '’ b']` and
  `['a“b', 'a “b']`, keeping insertion order `’tis`, `a,b`, `a(b`, `’b`,
  `a“b`, `-tis`, `word-`. In the positive loop at `:266` add `'a’b'` and
  `'a"b'` so it reads `['a, b', 'word’', 'a ’ b', 'Don’t', "'tis", "word'",
  '"tis', 'a"', 'a’b', 'a"b']`; let prettier re-wrap.
- Tests: `src/lib/tokenizers/word.test.ts` — the two lists above. Both pass at
  HEAD, because they pin existing behaviour; the defect is the prose, and these
  become the guard for it. No production code changes in this slice.
- Covers: AC1, R5-N1
- Commit: `test(#76): R5-N1 pin joiner and straight-quote adjacency`
- Reviewer note: check that every new case is genuinely measured — `’b` and
  `a“b` must hit the second assertion (`.not.toBe(normalizeWordText(input))`)
  and `a’b`/`a"b` must decode to the normalized input.

### S2 — restate the adjacency clause per joiner and straight quote

- Kind: mechanical
- Budget: 40 changed lines (estimate 30)
- Files:
  - `src/lib/tokenizers/README.md` (modify, `:63-67`): replace the failure
    clause with the text below.
  - `src/lib/tokenizers/word.ts` (modify, `decode` doc comment `:155-160`):
    the same sentences in comment form, `{@link needsSpace}` retained.
- Tests: none new; the wording is guarded by S1.
- Covers: AC1, R5-N1
- Commit: `docs(#76): R5-N1 state adjacency limits per joiner and quote`
- Reviewer note: read `README.md:59-73` and `word.ts:152-168` side by side —
  after this slice the two copies of the failure clause must match word for
  word (the surrounding sentences already differ slightly and stay untouched),
  and every example must appear in `word.test.ts:253-270`. Do not introduce a
  claim the test does not pin.

In both files, replace exactly the failure clause: from `The round trip`
(README.md:63) / `decode(encode(t).ids) === normalizeWordText(t)` (word.ts:155)
through the end of that sentence, which is the character just before the word
`Standalone`. That trailing `Standalone joiners ...` sentence and the rest of
the bullet stay as they are. Keep the two-space indent in the README and the
tab + ` * ` prefix in the comment; let prettier re-wrap the paragraph.

README replacement:

```
  The round trip `decode(encode(t).ids) === normalizeWordText(t)` holds only
  when the normalized input already contains a space wherever `needsSpace`
  would insert one. It fails when a closing mark is immediately followed by a
  letter, or a letter is immediately followed by an opening mark, unless the
  mark is a straight quote (`a"b`) or the mark and letter form one word
  (`a’b`). So `a,b`, `’b`, `a(b` and `a“b` fail.
```

Replacement for `word.ts:155-160`, matching the comment style (tab + ` * `):

```
	 * `decode(encode(t).ids) === normalizeWordText(t)` holds only when the
	 * normalized input already contains a space wherever {@link needsSpace}
	 * would insert one. It fails when a closing mark is immediately followed by
	 * a letter, or a letter is immediately followed by an opening mark, unless
	 * the mark is a straight quote (`a"b`) or the mark and letter form one word
	 * (`a’b`). So `a,b`, `’b`, `a(b` and `a“b` fail.
```

Why this wording is exact: a closing or opening mark loses its space only if
`needsSpace` returns false (`word.ts:208-213`), which happens for any closing
mark in the next position, any opening mark in the previous position, or when
the mark is `'`/`"` (in both sets). `’` is a closing mark but not an opening
mark, so a standalone `’` before a letter (`’b`) still inserts the space and
fails; only when `WORD_PATTERN` (`word.ts:14`) absorbs it between letters
(`a’b`) does it round-trip. Keep the "or the mark and letter form one word"
half — dropping it re-breaks `Don’t`.

## Coverage

- AC1 → S1 (new limit cases) + S2 (contract text). The prose round trip and
  the limit test run in `npx vitest run src/lib/tokenizers/word.test.ts`.
- AC2 → already satisfied by round-1 code (`word.test.ts:271-281`); unchanged.
- AC3 → already satisfied (`word.test.ts:339-376`); unchanged.
- AC4 → already satisfied (`word.test.ts:283-298`); unchanged.
- AC5 → already satisfied (`hf-tokenizer.ts:22-34`); unchanged.
- R5-N1 → S1 pins `’b`, `a“b`, `a’b`, `a"b`; S2 makes both prose copies match
  those measurements.

## Verification

- Per slice: `node scripts/slice-check.mjs --budget 25` (S1) and
  `--budget 40` (S2); it runs `npm run check` → `lint` → `format` → `test`,
  stages, and reports changed lines (exit 2 means split).
- Focused loop: `npx vitest run src/lib/tokenizers/word.test.ts`.
- Wording audit (run after S2, from the repo root):

  ```
  npx esbuild src/lib/tokenizers/word.ts --bundle --format=esm \
    --outfile=/tmp/opencode/word.mjs --log-level=error
  ```

  then from `/tmp/opencode` a `node` script that constructs
  `createWordTokenizer({ id: 'word', label: 'Word', description: '' }, ['the'])`
  and prints `decode(encode(s).ids)` plus the round-trip flag for
  `a,b`, `a(b`, `’b`, `a“b` (must fail) and `a’b`, `a"b`, `Don’t`, `word’`,
  `a ’ b`, `'tis`, `word'`, `"tis`, `a"` (must round-trip). Every example in
  the new sentence must appear in that output.
- Before pushing: `npm run test` once more and `npx prettier --check .`.
- No `## Smoke steps` section: no user-visible behaviour, no `data-testid`s, no
  e2e changes.

## Edge cases and risks

- `’` must not be blanket-exempted: `’b` fails at HEAD, so the exemption is the
  word token, not the character. This is the trap round 4 and round 5 both hit
  from opposite sides.
- `"` is not a `WORD_PATTERN` joiner yet `a"b` round-trips because it is in
  both punctuation sets; hence the separate "straight quote" half of the
  exemption.
- Risk: a seventh wording round. Mitigation: each documented example is pinned
  by a test, and the paragraph is now derived from `needsSpace` + `WORD_PATTERN`
  rather than enumerated per character.
- Residual risk (standing, not in scope): `README.md` and the `word.ts` comment
  are unsynchronized copies; no test asserts they match.

## Out of scope

- Everything on the review's "Missing tests and verification gaps" list that is
  not on the `- Open findings:` line: doc-sync test, `parseWordVocab` rank
  permutation differential, AC4 whole-string pin, negative-id tests for
  `decode`/`idsToTokens`, `version: Infinity`, whitespace-only `encode`,
  U+10400 segmentation, `a ,b`.
- Runtime/segmentation changes, registry entry, vectors, prose spans, UI,
  version bump.

## Open blocking questions

None. The reviewer's open question ("exclude `’` explicitly or delegate to the
joiner set?") is answered by neither: both would be false for `’b`, so the plan
delegates to the word token produced by `WORD_PATTERN` and keeps a separate
straight-quote exemption.

## Findings and actions

- **R5-N1** → S1 adds `’b` and `a“b` to the failing cases and `a’b`/`a"b` to
  the positive loop at `word.test.ts:253-270`; S2 rewrites the failure clause in
  `README.md:63-67` and `word.ts:155-160` as "straight quote, or the mark and
  letter form one word" so the text agrees with `Don’t` and with `’b`.
