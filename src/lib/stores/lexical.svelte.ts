import { browser } from '$app/environment';
import type { WeightFamilyId } from '$lib/strategies/weight-family.js';

export type LexicalStatus = 'idle' | 'ready';

/**
 * Reactive store for the lexical noise strategy's params.
 *
 * Owns user-configurable params ($k$, $\varepsilon$, `maxDistance`, $\tau$,
 * `family`). Neighborhoods are computed lazily inside the trajectory worker
 * on first visit — no precomputation or IndexedDB caching needed. Changing
 * any parameter is free (no recompute).
 */
class LexicalStore {
	/** Maximum edit distance for neighbor inclusion. */
	maxDistance: number = $state(2);
	/** Maximum neighbors per token. */
	k: number = $state(50);
	/** Ergodicity floor $\varepsilon$. */
	epsilon: number = $state(0);
	/** Softmax temperature $\tau$. */
	tau: number = $state(1.0);
	/** Weight family for the kernel. */
	family: WeightFamilyId = $state('exponential');

	/** Status: `'idle'` until first use, then `'ready'`. */
	status: LexicalStatus = $state('idle');

	/** Current params as a plain object (for passing to strategyConfigFor). */
	get params(): Record<string, unknown> {
		return {
			maxDistance: this.maxDistance,
			k: this.k,
			epsilon: this.epsilon,
			tau: this.tau,
			family: this.family,
		};
	}

	/** Mark the store as ready (called when tokenizer is available). */
	markReady(): void {
		if (!browser) return;
		this.status = 'ready';
	}
}

/** Singleton lexical store. */
export const lexicalStore = new LexicalStore();
