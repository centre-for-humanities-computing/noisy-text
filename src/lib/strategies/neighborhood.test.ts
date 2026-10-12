import { describe, it, expect } from 'vitest';
import { EditDistanceModel } from './distance-model.js';
import { NeighborhoodProvider } from './neighborhood.js';
import { resolveNeighbors } from './neighbor-softmax.js';

describe('NeighborhoodProvider', () => {
	const vocab = ['cat', 'cats', 'car', 'cart', 'dog', 'dogs', 'frog', 'log'];
	const model = new EditDistanceModel(vocab);
	const R_MAX = 2;

	it('has correct K and R_MAX', () => {
		const provider = new NeighborhoodProvider(model, R_MAX);
		expect(provider.K).toBe(vocab.length);
		expect(provider.R_MAX).toBe(R_MAX);
	});

	it('neighborsOf: returns sorted by distance ascending', () => {
		const provider = new NeighborhoodProvider(model, R_MAX);
		const neighbors = provider.neighborsOf(0); // 'cat'
		for (let i = 1; i < neighbors.length; i++) {
			expect(neighbors[i]!.dist).toBeGreaterThanOrEqual(neighbors[i - 1]!.dist);
		}
	});

	it('neighborsOf: all distances within R_MAX', () => {
		const provider = new NeighborhoodProvider(model, R_MAX);
		const neighbors = provider.neighborsOf(0);
		for (const n of neighbors) {
			expect(n.dist).toBeLessThanOrEqual(R_MAX);
		}
	});

	it('neighborsOf: finds "cats" and "car" for "cat" within R_MAX=2', () => {
		const provider = new NeighborhoodProvider(model, R_MAX);
		const neighbors = provider.neighborsOf(0);
		const ids = neighbors.map((n) => n.id);
		expect(ids).toContain(1); // cats
		expect(ids).toContain(2); // car
	});

	it('neighborsOf: memoizes (returns same reference)', () => {
		const provider = new NeighborhoodProvider(model, R_MAX);
		const a = provider.neighborsOf(0);
		const b = provider.neighborsOf(0);
		expect(a).toBe(b);
	});

	it('neighborsOf: empty for isolated token', () => {
		// 'frog' (id=6) at R_MAX=1: no neighbors within d=1.
		const provider = new NeighborhoodProvider(model, 1);
		const neighbors = provider.neighborsOf(6);
		expect(neighbors.length).toBe(0);
	});

	it('pair-cache: computing neighborhood of a populates distances for b', () => {
		// After computing neighborsOf(0), the pair-cache should have
		// d(0,1) stored, so neighborsOf(1) can skip the Levenshtein call.
		const provider = new NeighborhoodProvider(model, R_MAX);
		provider.neighborsOf(0); // 'cat'
		// 'cats' (id=1) should now have its neighborhood computable
		// without redundant Levenshtein calls.
		const neighbors = provider.neighborsOf(1);
		expect(neighbors.length).toBeGreaterThan(0);
		expect(neighbors.map((n) => n.id)).toContain(0); // 'cat' is a neighbor of 'cats'
	});
});

describe('NeighborhoodProvider memory bounds', () => {
	const vocab = ['cat', 'cats', 'car', 'cart', 'dog', 'dogs', 'frog', 'log'];
	const model = new EditDistanceModel(vocab);

	it('maxStored keeps only the nearest neighbors, in the same order', () => {
		const full = new NeighborhoodProvider(model, 2).neighborsOf(0);
		const capped = new NeighborhoodProvider(model, 2, { maxStored: 2 }).neighborsOf(0);
		expect(capped).toEqual(full.slice(0, 2));
	});

	it('read-time results are unchanged for any k <= maxStored', () => {
		const full = new NeighborhoodProvider(model, 2).neighborsOf(0);
		const capped = new NeighborhoodProvider(model, 2, { maxStored: 3 }).neighborsOf(0);
		for (const k of [1, 2, 3]) {
			expect(resolveNeighbors(capped, 2, k, 1.0)).toEqual(resolveNeighbors(full, 2, k, 1.0));
		}
	});

	it('pair cache stops at maxPairs, and distances stay exact', () => {
		const exact = new NeighborhoodProvider(model, 2).neighborsOf(0);
		const bounded = new NeighborhoodProvider(model, 2, { maxPairs: 0 });
		expect(bounded.neighborsOf(0)).toEqual(exact);
		expect((bounded as unknown as { _pairCache: Map<number, number> })._pairCache.size).toBe(0);
	});
});
