import type { EmbeddingMeta } from './types.js';

/**
 * Canonical text of an ordered vocabulary: words joined by `\n` with no
 * trailing newline, UTF-8 encoded. The Python exporter
 * (`scripts/export_word_vectors.py`) hashes exactly the same bytes, which
 * is what makes `vocabSha` a cross-language alignment contract.
 */
export function vocabCanonicalText(words: readonly string[]): string {
	return words.join('\n');
}

/** Lowercase hex encoding of a byte buffer. */
function toHex(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let hex = '';
	for (let i = 0; i < bytes.length; i++) {
		hex += bytes[i]!.toString(16).padStart(2, '0');
	}
	return hex;
}

/**
 * SHA-256 (WebCrypto) of `vocabCanonicalText(words)`, as lowercase hex.
 *
 * The Python bundle exporter computes the same digest over the same bytes;
 * the worker recomputes it here to refuse a matrix built from a different
 * vocabulary order.
 */
export async function wordVocabSha(words: readonly string[]): Promise<string> {
	const data = new TextEncoder().encode(vocabCanonicalText(words));
	return toHex(await crypto.subtle.digest('SHA-256', data));
}

/**
 * Verify a bundle's `vocabSha` against the active tokenizer vocabulary.
 *
 * No-op when the meta carries no `vocabSha` (gpt2/bert bundles index their
 * own tokenizer vocabulary and predate the contract). Throws on a mismatch
 * so the worker never pairs rows with a different word order.
 */
export async function verifyVocabSha(
	meta: Pick<EmbeddingMeta, 'source' | 'vocabSha'>,
	words: readonly string[],
): Promise<void> {
	if (meta.vocabSha === undefined) return;
	const got = await wordVocabSha(words);
	if (got !== meta.vocabSha) {
		throw new Error(
			`Embedding vocab SHA mismatch for "${meta.source}": expected ${meta.vocabSha}, got ${got}`,
		);
	}
}
