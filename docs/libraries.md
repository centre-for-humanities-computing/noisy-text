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

## `seedrandom` (^3.0.5)

Seeded PRNG. We use the Alea algorithm (`seedrandom.alea`) for speed
(~1.95 ns/call vs ~3.8 ns for default ARC4).

- **`seedrandom.alea(seed: string)`** — returns `() => number` in $[0, 1)$.
  Also has `.quick()` (32-bit float) and `.int32()` (signed 32-bit int).
- **HAZARD:** ARC4 key scheduler cycles short keys — `'1'`, `'11'`, `'111'`
  produce identical streams. We always append a null terminator:
  `seedrandom.alea(String(seed) + '\0')`.
- **Never** call `seedrandom(s, { global: true })` — it pollutes `Math.random`.
- Types are in the separate `@types/seedrandom` package (dev dependency).
