# Map

A narrative tour of how the parts of this repository fit together.
Format: prose under a few headings of your own; mark anything you are unsure of with `(?)`.
Its test: does the next session — you or an agent — become cheaper?

## WordNet

`scripts/export_wordnet.py` turns the pinned OEWN 2025 WN-LMF archive plus
`dist/word-vocab-50k.json` into `dist/wordnet/oewn-2025.bin` and `.meta.json`.
Rows are per resolved lemma group, keyed by the lowest static id; targets are
static ids; the manifest carries the category order, `vocabSha` and
attribution. `src/lib/wordnet/loader.ts` validates those and caches the typed
sections in the `wordnet` IndexedDB store; `table.ts` turns a token id or word
into a row and its outbound edges, and computes coverage. Nothing calls the
table until #94 wires it through the compute resolver, and the loader refuses
to run while `WORDNET_DATASET_REVISION` is the empty placeholder.
