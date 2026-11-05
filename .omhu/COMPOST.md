# Compost

Ideas worth keeping but not building yet: a short entry each, kept brief.
Format: `YYYY-MM-DD — idea — occurrence count — source`, all on one line.
The idea may run to a sentence or two; there are no continuation lines and no
paragraphs.
An idea is built when a second independent need appears, or a tend session picks it.
A line named in an open issue's `**Compost:**` line is scheduled; `/implement` deletes it when that issue lands.

2026-11-03 — A per-slice `e2e`; Playwright stays a round smoke step — 1 — plan 2 on #83
2026-11-03 — Auditing prompts beyond the four known gate sites — 1 — plan 2 on #83
2026-11-03 — One slice-size number in `AGENTS.md` itself — 1 — plan 2 on #83
2026-11-03 — Amending `d0c856c` to carry `Plan:` and `Slice:` trailers — 1 — plan 2 on #83
2026-11-04 — The workflow installer formats the files it writes, so install debt never lands as an unnamed slice — 1 — retro on #83
2026-11-04 — Restore slice-check's `':!.ai'` staging guard and drop `.prettierignore`'s `.claude/` line — 1 — parked in review 3 on PR #84
2026-11-04 — Excluding the space token and punctuation from the OOV count; the model counts every OOV id, so one unknown word in a spaced passage reads (+2 OOV) — 1 — plan 1 on #79
2026-11-04 — A second e2e spec for word prose; extend the existing word-tokenizer spec instead — 1 — plan 1 on #79
2026-11-04 — New UI controls, casing flags, typography changes or a different prose-rendering approach (§4.1 versus §10.2) — 1 — plan 1 on #79
2026-11-04 — Grouping the Tokens: count or other status numbers — 1 — plan 1 on #79
2026-11-05 — Tidy the word-tokenizer e2e leftovers: a throwing `readProse` helper, drop the redundant timeout, pin `Vocab: 40` in the first word test — 1 — review 2 on PR #86
2026-11-05 — No user-facing toggle to re-enable whitespace noising — 1 — plan 1 on #87
2026-11-05 — No punctuation freezing or punctuation hover suppression; punctuation stays inspectable — 1 — plan 1 on #87
2026-11-05 — No change to the kernel's uniform epsilon floor or the no-table fallback, so a non-frozen token can still land on whitespace when epsilon > 0; the destination policy is not absolute — 1 — plan 1 on #87
2026-11-05 — No OOV embedding rows; OOV ids stay text-only — 1 — plan 1 on #87
2026-11-05 — No incremental or prefix-extension provider rebuild; a changed OOV table rebuilds the model — 1 — plan 1 on #87
2026-11-05 — No GPT-2 or BERT changes; they do not expose standalone whitespace tokens — 1 — plan 1 on #87
2026-11-05 — Fold the worker's three strategy-to-provider switches into one helper; the refactor exceeds a mechanical slice's budget — 1 — plan 1 on #87
