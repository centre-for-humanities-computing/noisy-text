# Tokenizers

## How to add a new tokenizer

1. Pick a HuggingFace model id (e.g. `Xenova/t5-small`). It must be
   compatible with `@huggingface/transformers` (transformers.js).
2. Add an entry to `TOKENIZERS` in `registry.ts` with a unique kebab-case
   `id`, a human-readable `label`, and a short `description`.
3. Add the `id → modelId` mapping to `MODEL_NAMES` in `registry.ts`.
4. If the tokenizer needs special handling (non-standard vocab-size
   lookup, custom encode/decode options), extend `hf-tokenizer.ts` with
   a branch keyed on `info.id`. Prefer keeping the adapter generic.
5. Document any quirks (e.g. special-token behavior, vocab-size edge
   cases) in `docs/libraries.md`.

## Current tokenizers

| id                  | model                        | algorithm    |
|---------------------|------------------------------|--------------|
| `gpt2`              | `Xenova/gpt2`                | BPE          |
| `bert-base-uncased` | `Xenova/bert-base-uncased`   | WordPiece    |

## Notes

- `encode` passes `add_special_tokens: false` by default. BERT's
  `[CLS]`/`[SEP]` tokens are therefore omitted. A toggle may be added
  later.
- `idsToTokens` returns raw subword strings (e.g. `Ġ`, `##ing`) so
  chips show exactly what the tokenizer emits.
