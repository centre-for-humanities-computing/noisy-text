import type { Tokenizer, TokenizerInfo } from './types.js';
import type { WordVocabProgress } from './word-vocab-loader.js';
import { loadHfTokenizer } from './hf-tokenizer.js';
import { loadWordTokenizer } from './word-vocab-loader.js';

/** All known tokenizers, keyed by id. */
export const TOKENIZERS: Record<string, TokenizerInfo> = {
	gpt2: {
		id: 'gpt2',
		wordPiece: false,
		label: 'GPT-2 (BPE)',
		description: '50 257-token BPE tokenizer used by GPT-2 and GPT-3.',
		plainName: 'GPT-2 subwords',
		gloss:
			'Splits text into subword pieces used by GPT-2 and GPT-3 — common tokens stay whole, rare tokens break apart.',
		tooltip: {
			text: 'Byte-Pair Encoding (BPE) is a subword tokenizer that starts with characters and iteratively merges the most frequent pairs. Common tokens like "the" become single tokens; rare or made-up tokens are split into smaller pieces. GPT-2\'s vocabulary has 50,257 tokens.',
		},
	},
	'bert-base-uncased': {
		id: 'bert-base-uncased',
		wordPiece: true,
		label: 'BERT Base Uncased (WordPiece)',
		description: '30 522-token WordPiece tokenizer; lowercase + accent stripping.',
		plainName: 'BERT wordpieces',
		gloss:
			'Splits text into WordPiece tokens — lowercased, with word continuations marked by ## prefixes.',
		tooltip: {
			text: 'WordPiece is a subword tokenizer that builds a vocabulary by greedily splitting words into pieces that maximise training-data likelihood. Word continuations are marked with ## (e.g. "playing" → "play" + "##ing"). BERT\'s vocabulary has 30,522 tokens and lowercases all input.',
		},
	},
	words: {
		id: 'words',
		wordPiece: false,
		label: 'Word vocabulary (50k)',
		description: '50 000-word GloVe vocabulary; unknown tokens get per-instance ids.',
		plainName: 'Whole words',
		gloss:
			'Splits prose into whole words and gives each unknown word or character its own per-instance token.',
		tooltip: {
			text: 'Uses a 50 000-word GloVe vocabulary. Words in the list keep a fixed id; unknown words and punctuation receive append-only ids for the tokenizer instance, so the effective vocabulary grows as it sees text.',
			math: '$K = 50{,}000$; $K_{\\text{eff}} = K + |\\text{OOV}|$; the mask sentinel is $K_{\\text{eff}}$.',
		},
	},
} as const;

/** Loader signature shared by every tokenizer backend. */
export type TokenizerLoader = (
	info: TokenizerInfo,
	onProgress?: (progress: WordVocabProgress) => void,
) => Promise<Tokenizer>;

/* Map tokenizer id → loader. */
const LOADERS: Readonly<Record<string, TokenizerLoader>> = {
	gpt2: (info) => loadHfTokenizer(info, 'Xenova/gpt2'),
	'bert-base-uncased': (info) => loadHfTokenizer(info, 'Xenova/bert-base-uncased'),
	words: loadWordTokenizer,
};

/**
 * Load a tokenizer by its registry id.
 * The returned object is cached; subsequent calls for the same id return
 * the previously loaded instance.
 */
const _cache = new Map<string, Tokenizer>();

export async function loadTokenizer(
	id: string,
	onProgress?: (progress: WordVocabProgress) => void,
): Promise<Tokenizer> {
	const hit = _cache.get(id);
	if (hit) return hit;

	const info = TOKENIZERS[id];
	if (!info) {
		throw new Error(`Unknown tokenizer "${id}". Known: ${Object.keys(TOKENIZERS).join(', ')}`);
	}

	const loader = LOADERS[id];
	if (!loader) {
		throw new Error(`No loader mapping for tokenizer "${id}"`);
	}

	const tokenizer = await loader(info, onProgress);
	_cache.set(id, tokenizer);
	return tokenizer;
}
