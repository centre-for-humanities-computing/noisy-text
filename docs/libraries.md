# Libraries

Non-obvious API notes for dependencies we rely on.

## `@huggingface/transformers` (^3.8.1)

- **`AutoTokenizer.from_pretrained(modelId)`** — loads a tokenizer from the
  HuggingFace hub (or local cache). Returns a `PreTrainedTokenizer`.
- **`tokenizer.encode(text, { add_special_tokens: false })`** — returns
  `number[]` of token ids. We pass `add_special_tokens: false` to omit
  `[CLS]`/`[SEP]` etc.
- **`tokenizer.model.convert_ids_to_tokens(ids)`** — returns raw subword
  strings (e.g. `Ġ`, `##ing`). Used for chip rendering.
- **`tokenizer.decode(ids, { skip_special_tokens: false })`** — decodes
  ids back to text.
- **Vocab size** — `tokenizer.model.vocab` is a `string[]` on
  `TokenizerModel`; we just read `.length`.
