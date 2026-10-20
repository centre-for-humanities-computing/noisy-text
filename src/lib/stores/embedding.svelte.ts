import type { EmbeddingSourceId, MetricId, PreprocessId } from '$lib/embeddings/index.js';
import type { WeightFamilyId } from '$lib/strategies/weight-family.js';
import { EMBEDDING_KNN_DEFAULTS } from '$lib/strategies/embedding-knn-defaults.js';

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
	sourceId: EmbeddingSourceId = $state(EMBEDDING_KNN_DEFAULTS.sourceId);
	/** Row preprocessing before distance computation. */
	preprocess: PreprocessId = $state(EMBEDDING_KNN_DEFAULTS.preprocess);
	/** Distance metric over preprocessed rows. */
	metric: MetricId = $state(EMBEDDING_KNN_DEFAULTS.metric);
	/** Token-class filter for jump targets. */
	tokenClass: EmbeddingTokenClass = $state(EMBEDDING_KNN_DEFAULTS.tokenClass);
	/** Exclude special tokens (`[CLS]`, `</s>`, …). */
	excludeSpecial: boolean = $state(EMBEDDING_KNN_DEFAULTS.excludeSpecial);
	/** Exclude BERT `[unusedN]` rows. */
	excludeUnused: boolean = $state(EMBEDDING_KNN_DEFAULTS.excludeUnused);
	/** Exclude byte-fallback tokens (`<0x4F>`). */
	excludeByteFallback: boolean = $state(EMBEDDING_KNN_DEFAULTS.excludeByteFallback);
	/** Maximum neighbours per token. */
	k: number = $state(EMBEDDING_KNN_DEFAULTS.k);
	/** Ergodicity floor $\varepsilon$. */
	epsilon: number = $state(EMBEDDING_KNN_DEFAULTS.epsilon);
	/** Softmax temperature $\tau$. */
	tau: number = $state(EMBEDDING_KNN_DEFAULTS.tau);
	/** Weight family for the kernel. */
	family: WeightFamilyId = $state(EMBEDDING_KNN_DEFAULTS.family);

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
			maxDistance: EMBEDDING_KNN_DEFAULTS.maxDistance,
			k: this.k,
			epsilon: this.epsilon,
			tau: this.tau,
			family: this.family,
		};
	}
}

/** Singleton embedding store. */
export const embeddingStore = new EmbeddingStore();
