import type { EmbeddingKnnConfig } from './embedding-knn.js';

/**
 * Token classification and predicate construction for the embedding-knn
 * strategy.
 *
 * Embedding rows are indexed by the source model's vocabulary; without a
 * filter the walk can drift into special tokens (`[CLS]`, `</s>`),
 * BERT's `[unusedN]` padding rows, or byte-fallback tokens (`<0x4F>`).
 * `classifyTokens` assigns each token a bitmask once per tokenizer, and
 * `buildTokenPredicate` turns the config toggles into a fast test.
 *
 * Bit layout:
 * - bit0 word-initial
 * - bit1 continuation
 * - bit2 special
 * - bit3 unused (`[unusedN]`)
 * - bit4 byte-fallback (`<0x##>`)
 */

export type TokenClass = 'any' | 'word-initial' | 'continuation';

/** Bit flags in the classification mask. */
export const TOKEN_FLAG = {
	WORD_INITIAL: 1 << 0,
	CONTINUATION: 1 << 1,
	SPECIAL: 1 << 2,
	UNUSED: 1 << 3,
	BYTE_FALLBACK: 1 << 4,
} as const;

/** GPT-2 word-initial pieces carry the `Ġ` (space) prefix; BERT uses `##`. */
const GPT2_SPACE_PREFIX = 'Ġ';
const BERT_CONTINUATION_PREFIX = '##';

const BERT_SPECIAL = new Set([
	'[PAD]',
	'[UNK]',
	'[CLS]',
	'[SEP]',
	'[MASK]',
	'</s>',
	'<s>',
	'<pad>',
	'<unk>',
	'<mask>',
	'<|endoftext|>',
]);

/** `[unused0]` … `[unused993]` (BERT) and `unused…` variants. */
const UNUSED_RE = /^\[?unused\d+\]?$/;
/** SentencePiece / byte-fallback tokens like `<0x4F>`. */
const BYTE_FALLBACK_RE = /^<0x[0-9A-Fa-f]{2}>$/;

/**
 * Classify every token string into a bitmask (see the module doc).
 *
 * Word-initial vs continuation is tokenizer-specific: GPT-2 marks
 * continuation pieces by *lacking* the `Ġ` prefix (so any non-empty
 * token starting with `Ġ` is word-initial; a token without one is a
 * continuation), while BERT marks continuations explicitly with `##`.
 *
 * @param tokens - The $K$ token strings of the source vocabulary.
 * @param tokenizerId - `'gpt2'` or `'bert-base-uncased'`.
 */
export function classifyTokens(tokens: readonly string[], tokenizerId: string): Uint8Array {
	const masks = new Uint8Array(tokens.length);
	const isGpt2 = tokenizerId === 'gpt2';

	for (let i = 0; i < tokens.length; i++) {
		const s = tokens[i]!;
		let mask = 0;

		if (BERT_SPECIAL.has(s) || UNUSED_RE.test(s) || BYTE_FALLBACK_RE.test(s)) {
			// Special-ish tokens get their specific bits; word/continuation
			// classification is meaningless for them.
			if (BERT_SPECIAL.has(s)) mask |= TOKEN_FLAG.SPECIAL;
			if (UNUSED_RE.test(s)) mask |= TOKEN_FLAG.UNUSED;
			if (BYTE_FALLBACK_RE.test(s)) mask |= TOKEN_FLAG.BYTE_FALLBACK;
		} else {
			if (isGpt2) {
				if (s.startsWith(GPT2_SPACE_PREFIX) || i === 0) {
					mask |= TOKEN_FLAG.WORD_INITIAL;
				} else {
					mask |= TOKEN_FLAG.CONTINUATION;
				}
			} else {
				if (s.startsWith(BERT_CONTINUATION_PREFIX)) {
					mask |= TOKEN_FLAG.CONTINUATION;
				} else {
					mask |= TOKEN_FLAG.WORD_INITIAL;
				}
			}
		}
		masks[i] = mask;
	}
	return masks;
}

/**
 * Build the neighbour predicate from the classification masks and the
 * strategy config. A token is an admissible jump target when its token
 * class matches and none of the enabled exclusion flags are set.
 */
export function buildTokenPredicate(
	classes: Uint8Array,
	cfg: Pick<
		EmbeddingKnnConfig,
		'tokenClass' | 'excludeSpecial' | 'excludeUnused' | 'excludeByteFallback'
	>,
): (id: number) => boolean {
	return (id: number): boolean => {
		const mask = classes[id] ?? 0;
		if (cfg.excludeSpecial && mask & TOKEN_FLAG.SPECIAL) return false;
		if (cfg.excludeUnused && mask & TOKEN_FLAG.UNUSED) return false;
		if (cfg.excludeByteFallback && mask & TOKEN_FLAG.BYTE_FALLBACK) return false;
		switch (cfg.tokenClass) {
			case 'word-initial':
				return (mask & TOKEN_FLAG.WORD_INITIAL) !== 0;
			case 'continuation':
				return (mask & TOKEN_FLAG.CONTINUATION) !== 0;
			default:
				return true;
		}
	};
}
