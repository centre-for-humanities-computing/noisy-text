/** Uniform tokenizer interface that every backend must implement. */

/** Human-readable metadata for a tokenizer, used by the picker UI. */
export interface TokenizerInfo {
	/** Unique kebab-case id, e.g. `'gpt2'`. */
	id: string;
	/** Short display label, e.g. `'GPT-2 (BPE)'`. */
	label: string;
	/** One-line description shown in the picker or tooltip. */
	description: string;
	/** Plain-language name for a broad audience, e.g. `'GPT-2 subwords'`. */
	plainName: string;
	/** One-sentence plain-language gloss of what this tokenizer does. */
	gloss: string;
	/**
	 * True when a continuation piece's isolated decode carries a `##`
	 * prefix that the whole-sequence decode drops — but only after the
	 * first token; the first token is decoded raw.
	 */
	readonly wordPiece: boolean;
	/** Tooltip content: plain-language explanation followed by maths. */
	tooltip: {
		/** Plain-language explanation (first paragraph). */
		text: string;
		/** KaTeX maths string in $...$ notation (second paragraph). */
		math?: string;
	};
}

/**
 * Result of encoding a piece of text.
 *
 * `vocabSize` is the effective vocabulary size
 * $K_{\text{eff}} = K + |\text{OOV table}|$ at the time of the encode call,
 * not the tokenizer's static size $K$. Tokenizers with a fixed vocabulary
 * always report $K_{\text{eff}} = K$; tokenizers that allocate ids for
 * out-of-vocabulary tokens append to a per-instance table, so $K_{\text{eff}}$
 * grows as the instance sees new tokens. The mask sentinel is $K_{\text{eff}}$,
 * so it must be read from the result rather than from
 * {@link Tokenizer.vocabSize}.
 */
export interface EncodedText {
	/**
	 * Token ids. `Int32Array` because ids are non-negative integers and
	 * `Int32Array` is the numerics convention for token-id arrays.
	 */
	ids: Int32Array;
	/** Effective vocabulary size $K_{\text{eff}} = K + |\text{OOV table}|$ at encode time. */
	vocabSize: number;
}

/** A tokenizer ready for use. */
export interface Tokenizer {
	/** Metadata (same object passed at load time). */
	readonly info: TokenizerInfo;
	/**
	 * Static vocabulary size $K$; static ids are $0 \ldots K-1$.
	 *
	 * The effective size may be larger after OOV allocation; read
	 * {@link EncodedText.vocabSize} for the instance's current size.
	 */
	readonly vocabSize: number;

	/**
	 * Encode text → token ids plus the effective vocabulary size.
	 *
	 * Returning an object (rather than a bare `Int32Array`) makes any stale
	 * call site a compile error instead of silently treating the result as
	 * an id array.
	 */
	encode(text: string): EncodedText;

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

	/**
	 * Append-only per-instance table of out-of-vocabulary tokens. Index `i` has
	 * id `vocabSize + i`. Word-level tokenizers expose this; fixed-vocabulary
	 * HF tokenizers leave it undefined.
	 */
	readonly oovTokens?: readonly string[];
}
