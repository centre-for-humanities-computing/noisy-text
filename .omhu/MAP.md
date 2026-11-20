# Map

A narrative tour of how the parts of this repository fit together.
Format: a `## The parts` list of `- **Module** (\`path\`): what it does`, then
prose under a few headings of your own; mark anything you are unsure of with `(?)`.
Its test: does the next session — you or an agent — become cheaper?

## The parts

- **WordNet export** (`scripts/export_wordnet.py`): builds the pinned v2 OEWN bundle, its synset table and manifest from the 50k vocabulary.
- **WordNet loader** (`src/lib/wordnet/loader.ts`): validates the manifest and caches the typed sections, including per-edge synset indices, in IndexedDB.
- **WordNet table** (`src/lib/wordnet/table.ts`): resolves a token id or word to a row, its outbound edges with their synsets, and coverage.
- **WordNet strategy** (`src/lib/strategies/wordnet.ts`): walks one relation edge per jump over the decoded table.

## Front door

The app name lives in `src/routes/+layout.svelte` (header and `<title>`) and
`src/routes/+page.svelte` (`<h1>`, intro and button); the opening story lives in
`src/lib/components/AboutPanel.svelte`, `README.md`, `AGENT_CONTEXT.md` and
`DESIGN.md` §1/§8. First load opens on `embedding-knn` over GPT-2, but the
trajectory request starts only after "Walk it", so the bundle is fetched in
explore mode.

## WordNet

`scripts/export_wordnet.py` turns the pinned OEWN 2025 WN-LMF archive plus
`dist/word-vocab-50k.json` into `dist/wordnet/oewn-2025.bin` and `.meta.json`.
Rows are per resolved lemma group, keyed by the lowest static id; targets are
static ids; every edge carries source and target synset indices into a bundled
synset table; the manifest carries the category order, `vocabSha` and
attribution. `src/lib/wordnet/loader.ts` validates those and caches the typed
sections in the `wordnet` IndexedDB store; `table.ts` turns a token id or word
into a row, its outbound edges with their synsets, and computes coverage. The
worker loads the table for the `wordnet` strategy, builds one K_eff token-id →
row index shared by the kernel, freeze mask and coverage, and refuses any
tokenizer other than `words`. The loader refuses to run while
`WORDNET_DATASET_REVISION` is the empty placeholder.
