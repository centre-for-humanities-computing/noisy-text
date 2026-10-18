import type { EmbeddingSourceId, MetricId, PreprocessId } from '$lib/embeddings/index.js';
import type { WeightFamilyId } from '$lib/strategies/weight-family.js';

export type EmbeddingTokenClass = 'any' | 'word-initial' | 'continuation';

/**
 * Reactive store for the embedding-knn strategy's params.
 *
 * Owns user-configurable params (source, preprocessing, metric,
 * token-class filter, exclusions, $k$, $\varepsilon$, $\tau$,
 * `family`). The embedding matrix is fetched + decoded lazily inside the
 * trajectory worker and cached in IndexedDB; changing $k$, $\tau$,
 * `family` or $\varepsilon$ is free, while changing source/preprocess/
 * metric rebuilds the cached provider.
 */
class EmbeddingStore {
	/** Which embedding source (fixes the tokenizer pairing). */
	sourceId: EmbeddingSourceId = $state('gpt2');
	/** Row preprocessing before distance computation. */
	preprocess: PreprocessId = $state('none');
	/** Distance metric over preprocessed rows. */
	metric: MetricId = $state('cosine');
	/** Token-class filter for jump targets. */
	tokenClass: EmbeddingTokenClass = $state('any');
	/** Exclude special tokens (`[CLS]`, `</s>`, …). */
	excludeSpecial: boolean = $state(true);
	/** Exclude BERT `[unusedN]` rows. */
	excludeUnused: boolean = $state(true);
	/** Exclude byte-fallback tokens (`<0x4F>`). */
	excludeByteFallback: boolean = $state(true);
	/** Maximum neighbours per token. */
	k: number = $state(50);
	/** Ergodicity floor $\varepsilon$. */
	epsilon: number = $state(0);
	/** Softmax temperature $\tau$. */
	tau: number = $state(1.0);
	/** Weight family for the kernel. */
	family: WeightFamilyId = $state('exponential');

	/** Current params as a plain object (for passing to strategyConfigFor). */
	get params(): Record<string, unknown> {
		return {
			sourceId: this.sourceId,
			preprocess: this.preprocess,
			metric: this.metric,
			tokenClass: this.tokenClass,
			excludeSpecial: this.excludeSpecial,
			excludeUnused: this.excludeUnused,
			excludeByteFallback: this.excludeByteFallback,
			maxDistance: null,
			k: this.k,
			epsilon: this.epsilon,
			tau: this.tau,
			family: this.family,
		};
	}
}

/** Singleton embedding store. */
export const embeddingStore = new EmbeddingStore();
