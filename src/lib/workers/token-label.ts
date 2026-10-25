import type { Tokenizer } from '../tokenizers/types.js';

/**
 * Label a token id for display in inspection graphs.
 *
 * The mask sentinel $K_{\text{eff}}$ wins over the OOV table. For ids at or
 * beyond the tokenizer's static vocabulary $K$, look up the append-only OOV
 * table where index $i$ has id $K + i$; fall back to `#id` when the table has
 * no entry. Static ids decode through `idsToTokens`, with the same fallback.
 *
 * @param tok - The active tokenizer.
 * @param id - Token id to label.
 * @param vocabSize - Effective vocabulary size $K_{\text{eff}}$; the mask
 *   sentinel is `vocabSize`.
 * @param oovTokens - Append-only per-instance OOV table; index $i$ has id
 *   `tok.vocabSize + i`.
 */
export function tokenLabel(
	tok: Tokenizer,
	id: number,
	vocabSize: number,
	oovTokens?: readonly string[],
): string {
	if (id === vocabSize) return '[MASK]';
	if (id >= tok.vocabSize) return oovTokens?.[id - tok.vocabSize] ?? `#${id}`;
	return tok.idsToTokens(new Int32Array([id]))[0] ?? `#${id}`;
}
