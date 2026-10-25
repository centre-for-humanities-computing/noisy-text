# Tokenizers

## How to add a new tokenizer

1. Pick a HuggingFace model id (e.g. `Xenova/t5-small`). It must be
   compatible with `@huggingface/transformers` (transformers.js).
2. Add an entry to `TOKENIZERS` in `registry.ts` with a unique kebab-case
   `id`, a human-readable `label`, a short `description`, and a
   `wordPiece` flag — `true` when a continuation piece's isolated decode
   carries a `##` prefix that the whole-sequence decode drops after the
   first token (e.g. WordPiece), `false` otherwise (e.g. BPE).
3. Add the tokenizer's loader to the `LOADERS` map in `registry.ts`
   (`id → loader`). HuggingFace tokenizers wrap
   `loadHfTokenizer(info, modelId)`; the hosted word tokenizer uses
   `loadWordTokenizer`.
4. If the tokenizer needs special handling (non-standard vocab-size
   lookup, custom encode/decode options), extend `hf-tokenizer.ts` with
   a branch keyed on `info.id`. Prefer keeping the adapter generic.
5. Document any quirks (e.g. special-token behavior, vocab-size edge
   cases) in `docs/libraries.md`.

## Current tokenizers

| id                  | model                      | algorithm  |
| ------------------- | -------------------------- | ---------- |
| `gpt2`              | `Xenova/gpt2`              | BPE        |
| `bert-base-uncased` | `Xenova/bert-base-uncased` | WordPiece  |
| `words`             | hosted GloVe 50k           | word-level |

## Word tokenizer

`word.ts` and `word-vocab.ts` implement a pure word-level core. The `words`
entry in `registry.ts` wraps it with `loadWordTokenizer`, which fetches the
hosted 50 000-word GloVe vocabulary and caches the parsed list in IndexedDB.

- **Static ids.** `createWordTokenizer(info, words)` gives word `i` the static
  id $i$, so $K = \text{words.length}$ and static ids are $0 \ldots K-1$.
  Empty or duplicate vocabularies are rejected.
- **Effective size.** Any token missing from the static vocabulary gets a
  per-instance OOV id in first-seen order starting at $K$. Ids are
  append-only and reused across `encode` calls, so
  $K_{\text{eff}} = K + |\text{OOV}|$ grows monotonically. `encode` returns
  `{ ids, vocabSize }`, where `vocabSize` is $K_{\text{eff}}$ for that result.
  The mask sentinel is $K_{\text{eff}}$, not the static `Tokenizer.vocabSize`;
  consumers must read it from the encoded result.
- **Vocabulary files.** `parseWordVocab(value)` validates an already-parsed
  JSON object `{ version, source, license, words, ranks }` and returns the
  words ordered by ascending rank. `version` must be a finite number,
  `source`/`license` non-empty strings, `words` a non-empty array of unique,
  non-empty strings without whitespace, and `ranks` a permutation of
  $0 \ldots n-1$. Violations throw `Error('parseWordVocab: <reason>')`.
- **Normalization.** `normalizeWordText` converts `\r\n` and lone `\r` to
  `\n`, trims spaces and tabs at each line edge, and collapses internal runs
  of spaces and tabs to one space, preserving every newline.
- **Segmentation.** `segmentWordText` treats a maximal run of Unicode letters
  (category `L`) with internal `'`, `’` or `-` joiners as one verbatim word.
  Every other code point becomes its own token, including newlines; astral
  characters are never split.
- **Decoding.** Tokens are joined with one space, except that a `\n` token
  emits a bare newline, a `' '` token emits its own space, no space goes
  before closing punctuation (`. , ; : ! ? ) ] } % … ” ’ » › ' "`), no space
  goes after opening punctuation (`( [ { “ ‘ « ‹ ' "`), and the first token
  has no leading space.
- **Round-trip limits.** Digits, `/_@#`, emoji and unspaced neutral
  punctuation are separate tokens and gain spaces on decode. Combining marks
  are not letters and split from their base. Straight quotes appear in both
  punctuation sets, so they are ambiguous without an explicit space token.
  The round trip `decode(encode(t).ids) === normalizeWordText(t)` holds only
  when the normalized input already contains a space wherever `needsSpace`
  would insert one. It fails when a closing mark is immediately followed by a
  letter, or a letter is immediately followed by an opening mark, unless the
  mark is a straight quote (`a"b`) or the mark and letter form one word
  (`a’b`). So `a,b`, `’b`, `a(b` and `a“b` fail. Standalone
  joiners depend on the character: `’` gains a space before a word (`’tis` →
  `’ tis`) and `-` gains a space on either side (`-tis` → `- tis`, `word-` →
  `word -`), while straight quotes (`'`, `"`) belong to both punctuation sets
  and round-trip against a word (`'tis`, `word'`, `"tis`, `a"`). A standalone
  `’` after a word (`word’`), a spaced joiner (`a ’ b`) and an internal one
  (`Don’t`) round-trip.

### Hosting the word vocabulary

1. Download
   `https://huggingface.co/stanfordnlp/glove/resolve/main/glove.840B.300d.zip`
   and unzip `glove.840B.300d.txt`.
2. Run `python3 scripts/export_word_vocab.py --source glove.840B.300d.txt`.
   It writes `dist/word-vocab-50k.json` (50 000 words, ranked by frequency;
   `--out` overrides) and uploads it to `chcaa/noisy-text-embeddings` unless
   `--no-upload` is passed; in that case upload it with `hf upload`.
3. Copy the printed sha into `HF_DATASET_REVISION` in
   `src/lib/embeddings/loader.ts:30` (or set `VITE_WORD_VOCAB_BASE_URL` to a
   different base). Bumping the shared revision also invalidates the
   embedding-matrix caches.

## Notes

- `encode` passes `add_special_tokens: false` by default. BERT's
  `[CLS]`/`[SEP]` tokens are therefore omitted. A toggle may be added
  later.
- `idsToTokens` returns raw subword strings (e.g. `Ġ`, `##ing`) so
  chips show exactly what the tokenizer emits.
- `decode` inserts separators between pieces. For WordPiece, a
  single-id decode omits the space the whole-sequence decode inserts
  and retains the `##` continuation prefix, so lengths may not sum to
  the full decoded length (GPT-2's byte-level decoder already carries
  each piece's leading space); prose spans must be aligned against the
  decoded text (see `alignTokenPieces` in `src/lib/engine/diff.ts`).
- The `wordPiece` registry flag drives `##` normalization in the prose
  view: a WordPiece continuation after the first visible piece is
  stripped to match the whole-sequence decode, while the first visible
  piece keeps `##` (the whole-sequence decode decodes the first token
  raw) and non-WordPiece tokenizers are never modified.
