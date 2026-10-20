import { describe, it, expect } from 'vitest';
import { embeddingStore } from './embedding.svelte.js';
import { EMBEDDING_KNN_DEFAULTS } from '$lib/strategies/embedding-knn-defaults.js';

describe('embeddingStore defaults', () => {
	it('exposes the retuned defaults as params', () => {
		expect(embeddingStore.params).toEqual({
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
		});
	});

	it('matches the shared EMBEDDING_KNN_DEFAULTS constant (no drift)', () => {
		expect(embeddingStore.params).toEqual(EMBEDDING_KNN_DEFAULTS);
	});
});
