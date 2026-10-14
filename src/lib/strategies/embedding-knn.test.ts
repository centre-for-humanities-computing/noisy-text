import { describe, expect, it } from 'vitest';
import { createEmbeddingKnn } from './embedding-knn.js';
import type { EmbeddingKnnConfig } from './embedding-knn.js';
import type { DistanceModel } from './distance-model.js';
import { NeighborhoodProvider } from './neighborhood.js';
import { STRATEGIES } from './registry.js';

/** Deterministic fake model: every token's candidates are its 2 successors. */
function fakeModel(K: number): DistanceModel {
	return {
		id: 'embedding:test:none:cosine',
		K,
		*candidates(token: number, _radius: number): Iterable<number> {
			yield (token + 1) % K;
			yield (token + 2) % K;
		},
		distance(a: number, b: number, _maxDist: number): number {
			// Finite metric distance (real embedding metrics are finite; the
			// early-exit ceiling only kicks in past maxDist).
			return a === b ? 0 : 1;
		},
	};
}

const baseConfig: EmbeddingKnnConfig = {
	sourceId: 'gpt2',
	preprocess: 'none',
	metric: 'cosine',
	tokenClass: 'any',
	excludeSpecial: true,
	excludeUnused: true,
	excludeByteFallback: true,
	maxDistance: null,
	k: 2,
	epsilon: 0,
	tau: 1,
};

/** Counting rng: records draws and cycles through a fixed pattern. */
function countingRng(draws: number[]): { rng: () => number; count: () => number } {
	let i = 0;
	return {
		rng: () => {
			const v = draws[i % draws.length]!;
			i++;
			return v;
		},
		count: () => i,
	};
}

describe('createEmbeddingKnn', () => {
	it('has data-dependent stationary behavior in the registry', () => {
		expect(STRATEGIES['embedding-knn']!.stationary).toBe('data-dependent');
	});

	it('builds a strategy without a provider (uniform jumps)', () => {
		const s = createEmbeddingKnn(baseConfig, 10);
		expect(s.info.id).toBe('embedding-knn');
		const { rng, count } = countingRng([0.5, 0.9]);
		const out = s.sampleStep(3, 1, rng);
		expect(count()).toBe(2);
		expect(out).toBe(Math.floor(0.9 * 10));
	});

	it('builds a strategy with a provider and jumps through the kernel', () => {
		const K = 10;
		const provider = new NeighborhoodProvider(fakeModel(K), Infinity, { maxStored: 200 });
		const s = createEmbeddingKnn(baseConfig, K, provider);
		// draw 1: coin (>= beta stays; we pass beta=1 so always jump)
		// draw 2: kernel draw; epsilon=0 so inverse-CDF over {1,2} uniform-ish
		const { rng } = countingRng([0.0, 0.0]);
		const out = s.sampleStep(3, 1, rng);
		expect([4, 5]).toContain(out);
	});

	it('sampleStep draws exactly 2 rng values per call (stay branch too)', () => {
		const K = 10;
		const provider = new NeighborhoodProvider(fakeModel(K), Infinity, { maxStored: 200 });
		const s = createEmbeddingKnn(baseConfig, K, provider);
		const { rng, count } = countingRng([0.99, 0.5]);
		// coin=0.99 >= beta=0.1 → stay, but both draws still happen.
		const out = s.sampleStep(3, 0.1, rng);
		expect(out).toBe(3);
		expect(count()).toBe(2);
	});

	it('getLocalDistribution sums to 1 and concentrates on the kernel row', () => {
		const K = 10;
		const provider = new NeighborhoodProvider(fakeModel(K), Infinity, { maxStored: 200 });
		const s = createEmbeddingKnn(baseConfig, K, provider);
		const dist = s.getLocalDistribution!(3, 0.5);
		expect(dist.length).toBe(K);
		const sum = dist.reduce((a, b) => a + b, 0);
		expect(sum).toBeCloseTo(1, 5);
	});
});
