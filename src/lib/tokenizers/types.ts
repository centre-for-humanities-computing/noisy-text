/** Uniform tokenizer interface that every backend must implement. */

/** Human-readable metadata for a tokenizer, used by the picker UI. */
export interface TokenizerInfo {
	/** Unique kebab-case id, e.g. `'gpt2'`. */
	id: string;
	/** Short display label, e.g. `'GPT-2 (BPE)'`. */
	label: string;
	/** One-line description shown in the picker or tooltip. */
	description: string;
}

/** A tokenizer ready for use. */
export interface Tokenizer {
	/** Metadata (same object passed at load time). */
	readonly info: TokenizerInfo;
	/** Vocabulary size $K$. */
	readonly vocabSize: number;

	/**
	 * Encode text → token ids.
	 * Returns an `Int32Array` because ids are non-negative integers and
	 * `Int32Array` is the numerics convention for token-id arrays.
	 */
	encode(text: string): Int32Array;

	/**
	 * Decode token ids → text.
	 * Special tokens (if any) are passed through; the caller is responsible
	 * for filtering if desired.
	 */
	decode(ids: Int32Array): string;

	/**
	 * Map token ids → raw subword strings (the tokenizer's internal
	 * representation). Useful for rendering token chips so users see
	 * exactly what the tokenizer emits (e.g. `Ġ`, `##ing`).
	 */
	idsToTokens(ids: Int32Array): readonly string[];
}
