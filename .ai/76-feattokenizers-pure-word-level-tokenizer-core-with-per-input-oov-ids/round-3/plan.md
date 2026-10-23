# Plan — #76 fix round: review finding R2-N1

- Round: 3
- Addresses: R2-N1
- Slices: 1
- Estimated size: 20 changed lines

## Goal and context

Round 2 was reviewed at commit `64caa87` with verdict `fix-and-recheck` and no
blockers. The single open finding is a residual wording problem: the new
round-trip contract names "a standalone joiner adjacent to a word" as a failure,
but only a *leading* standalone joiner fails; a trailing one (`word’`), a spaced
one (`a ’ b`) and an internal one (`Don’t`) all round-trip. This round narrows
the clause and pins the passing cases. No runtime behaviour changes and no
version bump (revision round).

## Slices

### S1 — narrow the joiner clause and pin the passing cases (R2-N1)

- Kind: behavioral
- Budget: ≤30 changed lines (estimate 20)
- Files: `src/lib/tokenizers/README.md` (modify) — replace "or a standalone
  joiner is adjacent to a word (`’tis`)" with "or a standalone joiner begins a
  word (`’tis` → `’ tis`)", and state that a trailing standalone joiner
  (`word’`), a spaced one (`a ’ b`) and an internal one (`Don’t`) round-trip.
  `src/lib/tokenizers/word.ts` (modify, `decode` doc comment) — the same
  wording.
- Tests: `src/lib/tokenizers/word.test.ts` (modify) — extend the existing
  limit test's positive loop to `['a, b', 'word’', 'a ’ b', 'Don’t']`,
  asserting each round-trips; keep the three failure cases unchanged.
- Covers: the round-trip contract statement for AC1 and the distinction between
  leading joiners (fail) and trailing/spaced/internal joiners (pass).
- Commit: `docs(#76): narrow the round-trip joiner clause`
- Reviewer note: both comments and the test must state the same condition; the
  failure list must not claim that a trailing joiner fails.

## Findings and actions

- **R2-N1** → S1: state that only a standalone joiner that *begins* a word
  fails (`’tis` → `’ tis`), drop the general adjacency wording, document that
  `word’`, `a ’ b` and `Don’t` round-trip, and pin those positives in the
  existing limit test. Apply the same wording to `README.md` and `word.ts`.

## Verification

- Per slice: `node scripts/slice-check.mjs --budget 30` (check → lint → format
  → test, stages, reports changed lines; exit 2 means split).
- Focused loop: `npx vitest run src/lib/tokenizers/word.test.ts`.
- Before pushing: `npm run test`, `npx prettier --check .`. No `## Smoke steps`
  section: no user-visible behaviour and no e2e changes.
