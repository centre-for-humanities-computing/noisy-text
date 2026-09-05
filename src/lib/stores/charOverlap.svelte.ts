import { browser } from '$app/environment';

export type CharOverlapStatus = 'idle' | 'ready';

/**
 * Reactive store for the character-overlap noise strategy's params.
 *
 * Owns user-configurable params ($k$, $\varepsilon$, `minSimilarity`, $\tau$).
 * The `minSimilarity` slider maps to `maxDistance = 1 - minSimilarity`
 * internally so the config object stays uniform with the lexical strategy.
 * Neighborhoods are computed lazily inside the trajectory worker on first
 * visit — no precomputation or IndexedDB caching needed. Changing any
 * parameter is free (no recompute).
 */
class CharOverlapStore {
	/** Minimum Jaccard similarity for neighbor inclusion (in $[0, 1]$). */
	minSimilarity: number = $state(0.5);
	/** Maximum neighbors per token. */
	k: number = $state(50);
	/** Ergodicity floor $\varepsilon$. */
	epsilon: number = $state(0.01);
	/** Softmax temperature $\tau$. */
	tau: number = $state(1.0);

	/** Status: `'idle'` until first use, then `'ready'`. */
	status: CharOverlapStatus = $state('idle');

	/** Current params as a plain object (for passing to strategyConfigFor). */
	get params(): Record<string, unknown> {
		return {
			maxDistance: 1 - this.minSimilarity,
			k: this.k,
			epsilon: this.epsilon,
			tau: this.tau,
		};
	}

	/** Mark the store as ready (called when tokenizer is available). */
	markReady(): void {
		if (!browser) return;
		this.status = 'ready';
	}
}

/** Singleton char-overlap store. */
export const charOverlapStore = new CharOverlapStore();
