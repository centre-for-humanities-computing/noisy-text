import { oovSignature } from '../engine/trajectory-cache.js';

/**
 * Key for the worker's string-distance model/provider cache.
 *
 * The kernel and tokenizer identify the static vocabulary; the OOV content
 * signature makes a changed table miss so neighbourhoods are rebuilt over
 * the new $K_{\text{eff}}$ instead of reusing rows for ids that now mean
 * different strings.
 */
export function providerCacheKey(
	kernelId: string,
	tokenizerId: string,
	oovTokens?: readonly string[],
): string {
	return `${kernelId}:${tokenizerId}:${oovSignature(oovTokens)}`;
}
