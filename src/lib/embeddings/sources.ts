import type { EmbeddingSourceId, EmbeddingSourceInfo } from './types.js';

/**
 * Registry of embedding sources.
 *
 * `tokenizerId` **must** match one of the app tokenizers
 * (`src/lib/tokenizers`): the embedding rows are indexed by the source
 * model's own vocabulary, so a mismatched tokenizer would silently
 * measure distances between unrelated tokens. The worker validates the
 * pairing at provider build time and `+page.svelte` auto-selects the
 * tokenizer on source change.
 */
export const EMBEDDING_SOURCES: Record<EmbeddingSourceId, EmbeddingSourceInfo> = {
	'bert-base-uncased': {
		id: 'bert-base-uncased',
		label: 'BERT base (input)',
		plainName: 'BERT (input)',
		description: 'bert-base-uncased input word embeddings.',
		gloss: "Word embeddings from BERT's input table.",
		tooltip: {
			text: 'The input word-embedding matrix of bert-base-uncased; a good default for English word similarity.',
		},
		tokenizerId: 'bert-base-uncased',
		dim: 768,
		vocabSize: 30522,
		fileName: 'bert-base-uncased',
	},
	gpt2: {
		id: 'gpt2',
		label: 'GPT-2 (input)',
		plainName: 'GPT-2 (input)',
		description: 'GPT-2 input embeddings (wte).',
		gloss: "GPT-2's input word embeddings (wte); the default.",
		tooltip: {
			text: 'GPT-2 input embeddings (wte).',
		},
		tokenizerId: 'gpt2',
		dim: 768,
		vocabSize: 50257,
		fileName: 'gpt2',
	},
	'glove-840b-300d': {
		id: 'glove-840b-300d',
		label: 'GloVe 840B (300d)',
		plainName: 'GloVe words',
		description: 'GloVe 840B 300d static word vectors aligned to the 50k word vocabulary.',
		gloss: 'Word meaning from GloVe vectors; pairs with the word tokenizer.',
		tooltip: {
			text:
				'GloVe 840B 300d static word vectors, row-for-row aligned with the 50k whole-word vocabulary ' +
				'(one row per static word id). Pairs with the word tokenizer.',
		},
		tokenizerId: 'words',
		dim: 300,
		vocabSize: 50_000,
		fileName: 'glove-840b-300d',
	},
};

/**
 * Get an embedding source by id, throwing on unknown ids (mirrors the
 * registry's own-property guard in `strategies/registry.ts`).
 */
export function getEmbeddingSource(id: string): EmbeddingSourceInfo {
	if (!Object.hasOwn(EMBEDDING_SOURCES, id)) {
		throw new Error(
			`Unknown embedding source "${id}". Known: ${Object.keys(EMBEDDING_SOURCES).join(', ')}`,
		);
	}
	return EMBEDDING_SOURCES[id as EmbeddingSourceId];
}

/**
 * The embedding source whose vocabulary is indexed by `tokenizerId`, or
 * `null` when the tokenizer has no paired source. Used by `+page.svelte`
 * to keep a tokenizer's rows aligned when a strategy needs embeddings.
 */
export function sourceForTokenizer(tokenizerId: string): EmbeddingSourceId | null {
	const match = Object.values(EMBEDDING_SOURCES).find(
		(source) => source.tokenizerId === tokenizerId,
	);
	return match ? match.id : null;
}
