# Plan — #76 fix round: review finding R3-N1

- Round: 4
- Addresses: R3-N1
- Slices: 2
- Estimated size: 50 changed lines

## Goal and context

Round 3 was reviewed at commit `7e987fd` with verdict `fix-and-recheck`, no blockers, one open finding: the round-trip contract still generalizes "standalone joiner", but the three joiners (`'`, `’`, `-`) behave differently. Measured on the current code:

- `’tis` → `’ tis` (fails), `word’` → `word’` (passes)
- `'tis` → `'tis` (passes), `word'` → `word'` (passes) — `'` is in both `OPENING_PUNCTUATION` (`word.ts:90`) and `CLOSING_PUNCTUATION` (`word.ts:85`), so it attaches on either side
- `word-` → `word -` (fails), `-tis` → `- tis` (fails) — `-` is in neither set
- internal joiners (`Don’t`, `Don't`, `Don-t`) stay one token and pass

This round replaces the joiner clause with a per-character statement in `README.md` and the `decode` doc comment, and pins the missing cases in the existing limit test. No runtime behaviour changes; no version bump (revision round).

## Goal and acceptance criteria

- AC1: `decode(encode(t).ids)` equals the normalized `t` for multi-paragraph prose with punctuation, contractions and capitals.
- AC2: OOV words (unknown, capitalized, accented, hyphenated) decode verbatim, reuse their id on re-encode, and `encode` is idempotent.
- AC3: a seeded randomized test compares segmentation and OOV allocation against a naive reference on at least 500 generated strings.
- AC4: for every token, `decode([id])` appears verbatim and in order inside the whole-sequence decode, punctuation and newlines included.
- AC5: HF tokenizers satisfy `encode(...).vocabSize === tok.vocabSize`, and the app is unchanged.

Round-4 goal: make the documented round-trip contract true for all three joiners, and pin it.

## Slices

### S1 — pin the straight-apostrophe and hyphen round-trip cases in the limit test

- Kind: behavioral
- Budget: ≤20 changed lines (estimate 10)
- Files: `src/lib/tokenizers/word.test.ts` (modify, `'pins the documented round-trip limits for adjacent marks'`, currently `:253-267`) — no production code changes.
- Tests: add two failure rows to the existing `cases` table (`:255-259`): `['-tis', '- tis']` and `['word-', 'word -']` (each must also satisfy the existing `not.toBe(normalizeWordText(input))` assertion). Add `"'tis"` and `"word'"` to the positive loop at `:264` so it reads `['a, b', 'word’', 'a ’ b', 'Don’t', "'tis", "word'"]`; let prettier wrap the array. `normalizeWordText` is already imported (`word.test.ts:4`).
- Covers: AC1 (contract statement), R3-N1
- Commit: `test(#76): R3-N1 pin per-joiner round-trip limits`
- Reviewer note: every added expectation is already true of HEAD — this slice adds coverage, not behaviour. If any assertion fails, stop and report rather than editing `word.ts`.

### S2 — state the round-trip contract per punctuation class

- Kind: mechanical
- Budget: ≤150 changed lines (estimate 40)
- Files: `src/lib/tokenizers/README.md` (modify, `:63-69`) — replace the sentence beginning "It fails when a closing mark…" through "…internal one (`Don’t`) round-trips." with the text below, keeping lines 59-62 unchanged. `src/lib/tokenizers/word.ts` (modify, `decode` doc comment `:152-162`) — the same statement in comment form.
- Text (README; keep the two-space indent and the existing wrap width):

```
  The round trip `decode(encode(t).ids) === normalizeWordText(t)` holds only
  when the normalized input already contains a space wherever `needsSpace`
  would insert one. It fails when a closing mark is immediately followed by a
  letter (`a,b`) or a letter is immediately followed by an opening mark
  (`a(b`). Standalone joiners depend on the character: `’` gains a space
  before a word (`’tis` → `’ tis`) and `-` gains a space on either side
  (`-tis` → `- tis`, `word-` → `word -`), while `'` belongs to both
  punctuation sets and round-trips against a word (`'tis`, `word'`). A
  standalone `’` after a word (`word’`), a spaced joiner (`a ’ b`) and an
  internal one (`Don’t`) round-trip.
```

  Comment form for `word.ts` (same sentences, ` * ` prefix, `{@link needsSpace}` retained):

```
	 * Round-trip limits: digits, `/_@#`, emoji and unspaced neutral
	 * punctuation are separate tokens and gain spaces on decode; combining
	 * marks are not letters and also split. The round trip
	 * `decode(encode(t).ids) === normalizeWordText(t)` holds only when the
	 * normalized input already contains a space wherever {@link needsSpace}
	 * would insert one. It fails when a closing mark is immediately followed
	 * by a letter (`a,b`) or a letter is immediately followed by an opening
	 * mark (`a(b`). Standalone joiners depend on the character: `’` gains a
	 * space before a word (`’tis` → `’ tis`) and `-` gains a space on either
	 * side (`-tis` → `- tis`, `word-` → `word -`), while `'` belongs to both
	 * punctuation sets and round-trips against a word (`'tis`, `word'`). A
	 * standalone `’` after a word (`word’`), a spaced joiner (`a ’ b`) and
	 * an internal one (`Don’t`) round-trip.
```

- Tests: none new; S1 already pins every example. Do not touch `word.test.ts`.
- Covers: AC1 (contract statement), R3-N1
- Commit: `docs(#76): R3-N1 state round-trip limits per joiner`
- Reviewer note: verify each encoded token sequence and decode string in the wording against `needsSpace` (`word.ts:203-209`) and `WORD_PATTERN` (`word.ts:13-14`); no example may be a case the code does not produce.

## Coverage

- AC1 → S1 (per-joiner cases in the limit test) + S2 (contract text). Existing prose round trip `word.test.ts:241-251` stays green; `npx vitest run src/lib/tokenizers/word.test.ts` proves both.
- AC2 → already satisfied by round-1 code (`word.test.ts:269-279`); unchanged, no slice needed this round.
- AC3 → already satisfied (`word.test.ts:176-191`, `:337-421`); unchanged, no slice needed this round.
- AC4 → already satisfied (`word.test.ts:281-296`); unchanged, no slice needed this round.
- AC5 → already satisfied (`hf-tokenizer.ts:27-35`, `+page.svelte:159`); unchanged, no slice needed this round.

## Verification

- Per slice: `node scripts/slice-check.mjs --budget 20` (S1) and `node scripts/slice-check.mjs --budget 60` (S2); it runs `npm run check` → `lint` → `format` → `test`, stages, and reports changed lines (exit 2 means split).
- Focused loop: `npx vitest run src/lib/tokenizers/word.test.ts`.
- Wording audit: `node --experimental-strip-types --no-warnings -e "…"` printing `decode(encode(s).ids)` and the round-trip flag for `’tis`, `'tis`, `word’`, `word'`, `word-`, `-tis`, `-tis-`, `Don-t`, `a ’ b`, `a,b`, `a(b`; every documented example must match.
- Before pushing: `npm run test` and `npx prettier --check .`.
- No `## Smoke steps` section: no user-visible behaviour, no `data-testid`s, no e2e changes.

## Edge cases and risks

- Internal joiners (`Don-t`, `well-known`) are one token and pass; the new wording says "standalone" so it does not contradict them.
- `'` and `"` are in both punctuation sets; the wording names `'` explicitly and leaves `"` covered by the existing straight-quote sentence at `README.md:61-62`.
- Risk: a fifth wording round if the text is loosened again. Mitigation: the text names a character and an example for every claim, and S1 pins each one; prefer deleting a claim over generalizing it.
- Risk: the `word.ts` comment and `README.md` drift. Mitigation: identical sentences, same slice, one reviewer read of both.

## Out of scope

- The review's "Missing tests and verification gaps" list (`parseWordVocab` rank differential, AC4 whole-string pin, negative-id test, `version: Infinity`, whitespace-only encode, U+10400, `a ,b`) — not on the `- Open findings:` line, so not in this round.
- Any runtime/segmentation change, registry entry, vectors, prose spans, UI, version bump.

## Open blocking questions

None. The reviewer offered two fixes; this plan takes option (a) — narrow per punctuation class — because option (b) (dropping the clause) would leave the `-` failure (`word-` → `word -`) undocumented.

## Findings and actions

- **R3-N1** → S1 + S2: add `'tis`/`word'` positives and `-tis`/`word-` negatives to the limit test, then replace the "standalone joiner" generalization in `README.md:63-69` and `word.ts:152-162` with the per-character statement (`’` fails only before a word; `-` fails on either side; `'` round-trips; internal/spaced/trailing-`’` pass).
