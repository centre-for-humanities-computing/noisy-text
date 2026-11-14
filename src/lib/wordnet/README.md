# WordNet

The WordNet half of the playground: OEWN 2025 relations keyed by the static
50k word-vocabulary ids. The bundle is not shipped with the app. (The walk,
kernel and status line are #94.)

## Bundle format

`oewn-2025.bin` starts with a 16-byte little-endian header
`<4sIII` — magic `OEWN`, version 1, row count, edge count — followed by:

1. **row map** — `K` int32; token id → dense row index, `-1` when the token
   has no row.
2. **offsets** — `rows + 1` int32 CSR offsets into the targets.
3. **targets** — `edgeCount` int32 static token ids.
4. **categories** — `edgeCount` uint8 indices into `categoryOrder`.

`oewn-2025.meta.json` carries:

```json
{
	"source": "oewn-2025",
	"license": "CC BY 4.0",
	"attribution": "Princeton WordNet and the Open English WordNet (OEWN) team, https://en-word.net/downloads",
	"vocabSha": "...",
	"vocabSize": 50000,
	"rows": 0,
	"edgeCount": 0,
	"coveredLemmas": 0,
	"categoryOrder": ["hypernym", "hyponym", "synonym", "meronym", "holonym"]
}
```

`vocabSha` is the SHA-256 of the ordered vocabulary joined by `\n` and UTF-8
encoded — the canonical text hashed by `src/lib/embeddings/vocab-sha.ts`.
Rows are per distinct resolved lemma set, keyed by its lowest-ranked static
id. Hypernym includes `instance_hypernym`, meronym includes every `mero_*`
and holonym every `holo_*`; stored directions are inverted, so both directions
exist. A target reached through two categories appears once per category;
self edges are dropped by lemma. Targets are always static ids.

## Re-export runbook

1. Download OEWN 2025 from <https://en-word.net/downloads>:
   `english-wordnet-2025.xml.gz` (the 2025 edition, without Namenet proper
   nouns). CC BY 4.0; attribution to Princeton WordNet and the OEWN team.
2. Ensure the vocabulary is present at `dist/word-vocab-50k.json` (see
   `src/lib/tokenizers/README.md`).
3. `pip install wn` (Morphy) and `pip install numpy huggingface_hub`.
4. Export locally:
   `python scripts/export_wordnet.py --source english-wordnet-2025.xml.gz --vocab dist/word-vocab-50k.json --no-upload`
   (`--out` overrides `dist/wordnet`).
5. Upload and copy the printed sha:
   `python scripts/export_wordnet.py --source english-wordnet-2025.xml.gz --vocab dist/word-vocab-50k.json --repo chcaa/noisy-text-embeddings`
   then set `WORDNET_DATASET_REVISION` in `src/lib/wordnet/loader.ts`. It is
   intentionally separate from `HF_DATASET_REVISION`, so bumping WordNet
   leaves the embedding and word-vocabulary caches alone.

The exporter fails loudly if a target falls outside the static ids. The
loader refuses an empty `WORDNET_DATASET_REVISION`, so an unpinned
checkout cannot fetch the bundle.
