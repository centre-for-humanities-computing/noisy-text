import { describe, it, expect } from 'vitest';
import { createCharOverlap } from './char-overlap.js';
import { CharOverlapModel } from './char-overlap-model.js';
import { NeighborhoodProvider } from './neighborhood.js';
import type { CharOverlapConfig } from './char-overlap.js';

/**
 * A deterministic mock RNG that returns values from a predefined queue.
 */
function mockRng(values: number[]): () => number {
	let i = 0;
	return () => {
		const v = values[i]!;
		i = (i + 1) % values.length;
		return v;
	};
}

describe('createCharOverlap (no table — uniform fallback)', () => {
	const config: CharOverlapConfig = { maxDistance: 0.5, k: 20, epsilon: 0.1, tau: 1.0 };
	const K = 10;

	it('returns the strategy info', () => {
		const s = createCharOverlap(config, K);
		expect(s.info.id).toBe('char-overlap');
		expect(s.info.stationary).toBe('data-dependent');
	});

	it('sampleStep: stay when coin >= beta', () => {
		const s = createCharOverlap(config, K);
		const rng = mockRng([0.9]); // coin=0.9 >= beta=0.5 → stay
		expect(s.sampleStep(3, 0.5, rng)).toBe(3);
	});

	it('sampleStep: uniform jump when coin < beta and no table', () => {
		const s = createCharOverlap(config, K);
		// coin=0.3 < beta=0.5 → jump; draw=0.42 → floor(0.42*10)=4
		const rng = mockRng([0.3, 0.42]);
		expect(s.sampleStep(3, 0.5, rng)).toBe(4);
	});

	it('getLocalDistribution: uniform when no table', () => {
		const s = createCharOverlap(config, K);
		const dist = s.getLocalDistribution?.(0, 0.5);
		expect(dist).toBeDefined();
		let sum = 0;
		for (let i = 0; i < K; i++) sum += dist![i]!;
		expect(Math.abs(sum - 1)).toBeLessThan(1e-6);
	});
});

describe('createCharOverlap (with provider)', () => {
	// Build a tiny vocab: 5 tokens with known character overlaps.
	// 0:'cat', 1:'cats', 2:'car', 3:'cart', 4:'dog'
	const vocab = ['cat', 'cats', 'car', 'cart', 'dog'];
	const model = new CharOverlapModel(vocab);
	const provider = new NeighborhoodProvider(model, 1.0);
	const config: CharOverlapConfig = { maxDistance: 0.5, k: 20, epsilon: 0, tau: 1.0 };

	it('returns strategy metadata', () => {
		const s = createCharOverlap(config, vocab.length, provider);
		expect(s.info.id).toBe('char-overlap');
		expect(s.info.stationary).toBe('data-dependent');
	});

	it('sampleStep: stay when coin >= beta', () => {
		const s = createCharOverlap(config, vocab.length, provider);
		const rng = mockRng([0.9]); // coin >= 0.5 → stay
		expect(s.sampleStep(0, 0.5, rng)).toBe(0);
	});

	it('sampleStep: jump to closest neighbor (epsilon=0)', () => {
		const s = createCharOverlap(config, vocab.length, provider);
		// coin=0.3 < 0.5 → jump; draw=0.0 → first neighbor of 'cat'
		// 'cat' neighbors sorted by Jaccard distance:
		// 'cats' d=0.25, 'car' d=0.5, 'cart' d=0.5 (car & cart tied).
		const rng = mockRng([0.3, 0.0]);
		const result = s.sampleStep(0, 0.5, rng);
		const neighbors = provider.neighborsOf(0);
		const expected = neighbors[0]!.id;
		expect(result).toBe(expected);
	});

	it('sampleStep: draws exactly 2 rng values', () => {
		const s = createCharOverlap(config, vocab.length, provider);
		let callCount = 0;
		const countingRng = () => {
			callCount++;
			return 0.3;
		};
		s.sampleStep(0, 0.5, countingRng);
		expect(callCount).toBe(2);
	});

	it('sampleStep: draws exactly 2 rng values (stay branch)', () => {
		const s = createCharOverlap(config, vocab.length, provider);
		let callCount = 0;
		const countingRng = () => {
			callCount++;
			return 0.9;
		};
		s.sampleStep(0, 0.5, countingRng);
		expect(callCount).toBe(2);
	});

	it('sampleStep: uniform floor selection when epsilon > 0', () => {
		const epsConfig: CharOverlapConfig = { maxDistance: 0.5, k: 20, epsilon: 0.3, tau: 1.0 };
		const s = createCharOverlap(epsConfig, vocab.length, provider);
		// coin=0.3 < 0.5 → jump; draw=0.1 < epsilon=0.3 → uniform floor.
		// Within floor: scaled = 0.1/0.3 = 0.333 → floor(0.333*5) = 1.
		const rng = mockRng([0.3, 0.1]);
		expect(s.sampleStep(0, 0.5, rng)).toBe(1);
	});

	it('getLocalDistribution: returns buffer with correct length', () => {
		const s = createCharOverlap(config, vocab.length, provider);
		const dist = s.getLocalDistribution!(0, 0.5);
		expect(dist.length).toBe(vocab.length);
	});

	it('getLocalDistribution: sum to 1', () => {
		const s = createCharOverlap(config, vocab.length, provider);
		const dist = s.getLocalDistribution!(0, 0.5);
		let sum = 0;
		for (let i = 0; i < vocab.length; i++) sum += dist[i]!;
		expect(Math.abs(sum - 1)).toBeLessThan(1e-6);
	});

	it('getLocalDistribution: self has zero mass in jump dist when epsilon=0', () => {
		const s = createCharOverlap(config, vocab.length, provider);
		const dist = s.getLocalDistribution!(0, 0.5);
		expect(dist[0]).toBe(0);
	});

	it('sampleStep: empty neighbor list falls back to uniform', () => {
		// Build model where one token has no neighbors within maxDistance.
		const sparseVocab = ['a', 'ab', 'xyz'];
		const sparseModel = new CharOverlapModel(sparseVocab);
		const sparseProvider = new NeighborhoodProvider(sparseModel, 1.0);
		// 'xyz' (id=2) shares no chars with 'a' or 'ab' → d=1 for both.
		// With maxDistance=0.5, no neighbors.
		const tightConfig: CharOverlapConfig = { maxDistance: 0.5, k: 20, epsilon: 0, tau: 1.0 };
		const s = createCharOverlap(tightConfig, sparseVocab.length, sparseProvider);
		// coin=0.3 < 0.5 → jump; draw=0.7 → floor(0.7*3)=2.
		const rng = mockRng([0.3, 0.7]);
		expect(s.sampleStep(2, 0.5, rng)).toBe(2);
	});

	it('empirical irreducibility: chain visits diverse tokens', () => {
		const epsConfig: CharOverlapConfig = { maxDistance: 0.5, k: 20, epsilon: 0.1, tau: 1.0 };
		const s = createCharOverlap(epsConfig, vocab.length, provider);
		let seq = 0;
		const seqRng = () => {
			seq = (seq + 0.37) % 1;
			return seq;
		};

		for (let start = 0; start < vocab.length; start++) {
			const visited = new Set<number>();
			let token = start;
			for (let step = 0; step < 100; step++) {
				token = s.sampleStep(token, 0.3, seqRng);
				visited.add(token);
			}
			expect(visited.size).toBeGreaterThan(1);
		}
	});
});
