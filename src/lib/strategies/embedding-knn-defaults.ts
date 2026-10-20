import type { EmbeddingKnnConfig } from './embedding-knn.js';

/**
 * Canonical defaults for the embedding-knn strategy.
 *
 * Single source of truth read by both the UI store
 * (`src/lib/stores/embedding.svelte.ts`) and the registry fallback
 * (`src/lib/strategies/registry.ts`) so the two can never drift. Must
 * match the retuned values documented in
 * `src/lib/embeddings/README.md` (Notes).
 */
export const EMBEDDING_KNN_DEFAULTS: Required<EmbeddingKnnConfig> = {
	sourceId: 'gpt2',
	preprocess: 'mean-center',
	metric: 'cosine',
	tokenClass: 'word-initial',
	excludeSpecial: true,
	excludeUnused: true,
	excludeByteFallback: true,
	maxDistance: null,
	k: 20,
	epsilon: 0,
	tau: 0.1,
	family: 'exponential',
};
