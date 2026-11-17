# WordNet

The WordNet half of the playground: OEWN 2025 relations keyed by the static
50k word-vocabulary ids. The bundle is not shipped with the app.

The `wordnet` strategy walks one relation edge per jump. Each non-empty
relation category (hypernym, hyponym, synonym, meronym, holonym) gets equal
mass, shared uniformly across its targets; a lemma with no outbound edge stays
put. The worker builds one K_eff token-id → row index and uses it for the
kernel, the freeze mask and coverage, so OOV case variants walk the same row
as their static lemma.

## Bundle format

`oewn-2025.bin` starts with a 20-byte little-endian header
`<4sIIII` — magic `OEWN`, version 2, row count, edge count, synset count —
followed by:

1. **row map** — `K` int32; token id → dense row index, `-1` when the token
   has no row.
2. **offsets** — `rows + 1` int32 CSR offsets into the targets.
3. **targets** — `edgeCount` int32 static token ids.
4. **source synsets** — `edgeCount` int32 indices into the synset table.
5. **target synsets** — `edgeCount` int32 indices into the synset table.
6. **synset offsets** — `synsetCount + 1` int32 CSR offsets into the blob.
7. **categories** — `edgeCount` uint8 indices into `categoryOrder`.
8. **synset blob** — concatenated `<id>\t<label>` UTF-8 entries.

Every int32 view precedes the uint8 categories column and the trailing blob,
so the typed-array views stay 4-byte aligned. Edges are deduplicated and
sorted on `(target id, category, source synset, target synset)`, so two
exports of the same archive are identical; a synonym edge shares one synset
at both ends. A synset label is its lemma with the lowest static vocabulary
id (lexicographic tie-break) plus the POS from the id suffix, for example
`oewn-02086723-n` → `dog (n.)`.

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
	"synsetCount": 0,
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

One edge per `(source synset, target synset, target lemma, category)` means a
target reachable from two senses now has two edges. Category mass stays
$1/m$; each edge takes an equal share of its category, so that target receives
double mass. This is intended: the walk samples one edge, and #91 can name the
sense a jump came from.

## Re-export runbook

1. Download OEWN 2025 from <https://en-word.net/downloads>:
   `english-wordnet-2025.xml.gz` (the 2025 edition, without Namenet proper
   nouns). CC BY 4.0; attribution to Princeton WordNet and the OEWN team.
2. Ensure the vocabulary is present at `dist/word-vocab-50k.json` (see
   `src/lib/tokenizers/README.md`).
3. `pip install wn` (Morphy) and `pip install numpy huggingface_hub`.
4. Export locally:
   `python scripts/export_wordnet.py --source english-wordnet-2025.xml.gz --vocab dist/word-vocab-50k.json --no-upload`
   (`--out` overrides `dist/wordnet`). It prints the row, edge and synset
   counts and writes a version 2 bundle.
5. Upload and copy the printed sha:
   `python scripts/export_wordnet.py --source english-wordnet-2025.xml.gz --vocab dist/word-vocab-50k.json --repo chcaa/noisy-text-embeddings`
   then set `WORDNET_DATASET_REVISION` in `src/lib/wordnet/loader.ts`. It is
   intentionally separate from `HF_DATASET_REVISION`, so bumping WordNet
   leaves the embedding and word-vocabulary caches alone.

The exporter fails loudly if a target falls outside the static ids. The
loader accepts only bundle version 2 (a v1 bundle fails with
`unsupported bundle version 1`), and refuses an empty
`WORDNET_DATASET_REVISION`, so an unpinned checkout cannot fetch the bundle.
