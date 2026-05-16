import type { Tokenizer, TokenizerInfo } from './types.js';
import { loadHfTokenizer } from './hf-tokenizer.js';

/** All known tokenizers, keyed by id. */
export const TOKENIZERS: Record<string, TokenizerInfo> = {
	gpt2: {
		id: 'gpt2',
		label: 'GPT-2 (BPE)',
		description: '50 257-token BPE tokenizer used by GPT-2 and GPT-3.',
	},
	'bert-base-uncased': {
		id: 'bert-base-uncased',
		label: 'BERT Base Uncased (WordPiece)',
		description: '30 522-token WordPiece tokenizer; lowercase + accent stripping.',
	},
} as const;

/* Map tokenizer id → HuggingFace model id. */
const MODEL_NAMES: Readonly<Record<keyof typeof TOKENIZERS, string>> = {
	gpt2: 'Xenova/gpt2',
	'bert-base-uncased': 'Xenova/bert-base-uncased',
};

/**
 * Load a tokenizer by its registry id.
 * The returned object is cached; subsequent calls for the same id return
 * the previously loaded instance.
 */
const _cache = new Map<string, Tokenizer>();

export async function loadTokenizer(id: string): Promise<Tokenizer> {
	const hit = _cache.get(id);
	if (hit) return hit;

	const info = TOKENIZERS[id];
	if (!info) {
		throw new Error(`Unknown tokenizer "${id}". Known: ${Object.keys(TOKENIZERS).join(', ')}`);
	}

	const modelId = MODEL_NAMES[id as keyof typeof MODEL_NAMES];
	if (!modelId) {
		throw new Error(`No model mapping for tokenizer "${id}"`);
	}

	const tokenizer = await loadHfTokenizer(info, modelId);
	_cache.set(id, tokenizer);
	return tokenizer;
}
