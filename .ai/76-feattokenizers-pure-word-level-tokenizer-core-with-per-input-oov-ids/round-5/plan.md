# Plan — #76 fix round: review finding R4-N1

- Round: 5
- Addresses: R4-N1
- Slices: 1
- Estimated size: 30 changed lines

## Goal and context

Round 4 was reviewed at commit `b09e5af` with verdict `fix-and-recheck`, no blockers, one open finding: the round-trip paragraph's adjacent-mark clauses still say a closing mark followed by a letter (`a,b`) and a letter followed by an opening mark (`a(b`) always fail, but straight quotes are in both punctuation sets. Measured on the current code (`word.ts:69-90`, `203-209`):

- `'tis` → `'tis` (passes), `a'` → `a'` (passes)
- `"tis` → `"tis` (passes), `a"` → `a"` (passes)
- `a,b` → `a, b` (fails), `a(b` → `a (b` (fails)

The next sentence already cites `'tis` as a passing joiner, so the paragraph contradicts itself; `"tis` and `a"` pass with no stated exception. This round qualifies both adjacent-mark clauses with "other than a straight quote" in `README.md` and the `decode` doc comment, and pins `"tis`/`a"` in the existing limit test. No runtime behaviour changes; no version bump (revision round).

## Goal and acceptance criteria

- AC1: `decode(encode(t).ids)` equals the normalized `t` for multi-paragraph prose with punctuation, contractions and capitals.
- AC2: OOV words (unknown, capitalized, accented, hyphenated) decode verbatim, reuse their id on re-encode, and `encode` is idempotent.
- AC3: a seeded randomized test compares segmentation and OOV allocation against a naive reference on at least 500 generated strings.
- AC4: for every token, `decode([id])` appears verbatim and in order inside the whole-sequence decode, punctuation and newlines included.
- AC5: HF tokenizers satisfy `encode(...).vocabSize === tok.vocabSize`, and the app is unchanged.

Round-5 goal: make the documented adjacent-mark failure clauses true for straight quotes, and pin the straight-quote exceptions.

## Slices

### S1 — qualify the adjacent-mark clauses and pin the straight-quote cases

- Kind: behavioral
- Budget: ≤40 changed lines (estimate 30)
- Files: `src/lib/tokenizers/word.test.ts` (modify, limit test at `:253-269`) — add `"tis"` and `'a"'` to the positive loop at `:266`, which then reads `['a, b', 'word’', 'a ’ b', 'Don’t', "'tis", "word'", '"tis', 'a"']`; let prettier wrap. `src/lib/tokenizers/README.md` (modify, `:65-70`) — insert "other than a straight quote" after "closing mark" and after "opening mark", and name both straight quotes in the joiner sentence ("`'`, `\"`" with examples `'tis`, `word'`, `\"tis`, `a\"`). `src/lib/tokenizers/word.ts` (modify, `decode` doc comment `:157-164`) — the identical statement in comment form.
- Tests: the two new positives; no new test file. They pass at HEAD (they pin the exception the prose was missing), so the fix is the wording and the test is the guard.
- Covers: AC1 (contract statement), R4-N1
- Commit: `fix(#76): R4-N1 qualify straight quotes in round-trip limits`
- Reviewer note: every example must be produced by `needsSpace` (`word.ts:203-209`) and `WORD_PATTERN` (`word.ts:13-14`); do not add a claim that is not exercised by a test.

Proposed README text (keep the two-space indent and existing wrap width):

```
  The round trip `decode(encode(t).ids) === normalizeWordText(t)` holds only
  when the normalized input already contains a space wherever `needsSpace`
  would insert one. It fails when a closing mark other than a straight quote
  is immediately followed by a letter (`a,b`) or a letter is immediately
  followed by an opening mark other than a straight quote (`a(b`). Standalone
  joiners depend on the character: `’` gains a space before a word (`’tis` →
  `’ tis`) and `-` gains a space on either side (`-tis` → `- tis`, `word-` →
  `word -`), while straight quotes (`'`, `"`) belong to both punctuation sets
  and round-trip against a word (`'tis`, `word'`, `"tis`, `a"`). A standalone
  `’` after a word (`word’`), a spaced joiner (`a ’ b`) and an internal one
  (`Don’t`) round-trip.
```

Comment form for `word.ts` (same sentences, ` * ` prefix, `{@link needsSpace}` retained):

```
	 * would insert one. It fails when a closing mark other than a straight
	 * quote is immediately followed by a letter (`a,b`) or a letter is
	 * immediately followed by an opening mark other than a straight quote
	 * (`a(b`). Standalone joiners depend on the character: `’` gains a space
	 * before a word (`’tis` → `’ tis`) and `-` gains a space on either side
	 * (`-tis` → `- tis`, `word-` → `word -`), while straight quotes (`'`,
	 * `"`) belong to both punctuation sets and round-trip against a word
	 * (`'tis`, `word'`, `"tis`, `a"`). A standalone `’` after a word
	 * (`word’`), a spaced joiner (`a ’ b`) and an internal one (`Don’t`)
	 * round-trip.
```

## Coverage

- AC1 → S1 (straight-quote positives in the limit test) + S1 (contract text). Existing prose round trip (`word.test.ts:241-251`) stays green; `npx vitest run src/lib/tokenizers/word.test.ts` proves both.
- AC2 → already satisfied by round-1 code (`word.test.ts:271-281`); unchanged.
- AC3 → already satisfied (`word.test.ts:176-192`, `:339-376`); unchanged.
- AC4 → already satisfied (`word.test.ts:283-298`); unchanged.
- AC5 → already satisfied (`hf-tokenizer.ts:22-34`, `+page.svelte:156-161`); unchanged.

## Verification

- Per slice: `node scripts/slice-check.mjs --budget 40`; it runs `npm run check` → `lint` → `format` → `test`, stages, and reports changed lines (exit 2 means split).
- Focused loop: `npx vitest run src/lib/tokenizers/word.test.ts`.
- Wording audit: `node --experimental-strip-types --no-warnings -e "…"` printing `decode(encode(s).ids)` and the round-trip flag for `’tis`, `'tis`, `"tis`, `word’`, `word'`, `a"`, `a'`, `word-`, `-tis`, `a,b`, `a(b`; every documented example must match.
- Before pushing: `npm run test` and `npx prettier --check .`.
- No `## Smoke steps` section: no user-visible behaviour, no `data-testid`s, no e2e changes.

## Edge cases and risks

- The "other than a straight quote" qualifier is exactly the condition: straight quotes suppress the space on both sides, so both adjacent-mark clauses need it.
- Naming both straight quotes in the joiner sentence cannot over-generalize to `-`/`’`, which keep their explicit per-character clauses.
- Risk: a sixth wording round. Mitigation: every example in the sentence is pinned by `word.test.ts:253-270`; prefer deleting a claim over generalizing it.

## Out of scope

- The review's "Missing tests and verification gaps" list (README/word.ts sync test, `parseWordVocab` rank differential, AC4 whole-string pin, negative-id test, `version: Infinity`, whitespace-only encode, U+10400, `a ,b`) — not on the `- Open findings:` line, so not in this round.
- Any runtime/segmentation change, registry entry, vectors, prose spans, UI, version bump.

## Open blocking questions

None. The reviewer offered a wording fix and the exact straight-quote cases to pin; the plan applies both.

## Findings and actions

- **R4-N1** → S1: add `"tis` and `a"` positives to the limit test, then qualify both adjacent-mark clauses in `README.md:65-70` and `word.ts:157-164` with "other than a straight quote" and name both straight quotes in the joiner sentence.
