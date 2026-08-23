import { describe, it, expect } from 'vitest';
import { createLexical } from './lexical.js';
import { computeNeighborTable } from './lexical-neighbors.js';
import type { LexicalConfig } from './lexical.js';

/**
 * A deterministic mock RNG that returns values from a predefined queue.
 * Allows testing branch behavior without actual randomness.
 */
function mockRng(values: number[]): () => number {
	let i = 0;
	return () => {
		const v = values[i]!;
		i = (i + 1) % values.length;
		return v;
	};
}

describe('createLexical (no table — uniform fallback)', () => {
	const config: LexicalConfig = { maxDistance: 2, k: 20, epsilon: 0.1, tau: 1.0 };
	const K = 10;

	it('returns the strategy info', () => {
		const s = createLexical(config, K);
		expect(s.info.id).toBe('lexical');
		expect(s.info.stationary).toBe('data-dependent');
	});

	it('sampleStep: stay when coin >= beta', () => {
		const s = createLexical(config, K);
		const rng = mockRng([0.9]); // coin=0.9 >= beta=0.5 → stay
		expect(s.sampleStep(3, 0.5, rng)).toBe(3);
	});

	it('sampleStep: uniform jump when coin < beta and no table', () => {
		const s = createLexical(config, K);
		// coin=0.3 < beta=0.5 → jump; draw=0.42 → floor(0.42*10)=4
		const rng = mockRng([0.3, 0.42]);
		expect(s.sampleStep(3, 0.5, rng)).toBe(4);
	});

	it('getLocalDistribution: uniform when no table', () => {
		const s = createLexical(config, K);
		const dist = s.getLocalDistribution?.(0, 0.5);
		expect(dist).toBeDefined();
		let sum = 0;
		for (let i = 0; i < K; i++) sum += dist![i]!;
		expect(Math.abs(sum - 1)).toBeLessThan(1e-6);
	});
});

describe('createLexical (with table)', () => {
	// Build a tiny neighbor table: 5 tokens with known distances.
	// 0:'cat', 1:'cats', 2:'car', 3:'cart', 4:'dog'
	const vocab = ['cat', 'cats', 'car', 'cart', 'dog'];
	const table = computeNeighborTable(vocab, { maxDistance: 2, k: 20, tau: 1.0 });
	const config: LexicalConfig = { maxDistance: 2, k: 20, epsilon: 0, tau: 1.0 };

	it('returns strategy metadata', () => {
		const s = createLexical(config, vocab.length, table);
		expect(s.info.id).toBe('lexical');
		expect(s.info.stationary).toBe('data-dependent');
	});

	it('sampleStep: stay when coin >= beta', () => {
		const s = createLexical(config, vocab.length, table);
		const rng = mockRng([0.9]); // coin >= 0.5 → stay
		expect(s.sampleStep(0, 0.5, rng)).toBe(0);
	});

	it('sampleStep: jump to a lexical neighbor (epsilon=0)', () => {
		const s = createLexical(config, vocab.length, table);
		// coin=0.3 < 0.5 → jump; draw=0.0 → first lexical neighbor of 'cat'
		// 'cat' neighbors: 'cats'(d=1), 'car'(d=1), 'cart'(d=2)
		const rng = mockRng([0.3, 0.0]);
		const result = s.sampleStep(0, 0.5, rng);
		// Should be the first neighbor (highest weight = closest dist).
		const start = table.offsets[0]!;
		const expected = table.neighborIds[start]!;
		expect(result).toBe(expected);
	});

	it('sampleStep: draws exactly 2 rng values', () => {
		const s = createLexical(config, vocab.length, table);
		let callCount = 0;
		const countingRng = () => { callCount++; return 0.3; };
		s.sampleStep(0, 0.5, countingRng);
		expect(callCount).toBe(2);
	});

	it('sampleStep: draws exactly 2 rng values (stay branch)', () => {
		const s = createLexical(config, vocab.length, table);
		let callCount = 0;
		const countingRng = () => { callCount++; return 0.9; };
		s.sampleStep(0, 0.5, countingRng);
		expect(callCount).toBe(2);
	});

	it('sampleStep: uniform floor selection when epsilon > 0', () => {
		const epsConfig: LexicalConfig = { maxDistance: 2, k: 20, epsilon: 0.3, tau: 1.0 };
		const s = createLexical(epsConfig, vocab.length, table);
		// coin=0.3 < 0.5 → jump; draw=0.1 < epsilon=0.3 → uniform floor.
		// Within floor: scaled = 0.1/0.3 = 0.333 → floor(0.333*5) = 1.
		const rng = mockRng([0.3, 0.1]);
		expect(s.sampleStep(0, 0.5, rng)).toBe(1);
	});

	it('getLocalDistribution: returns buffer with correct length', () => {
		const s = createLexical(config, vocab.length, table);
		const dist = s.getLocalDistribution!(0, 0.5);
		expect(dist.length).toBe(vocab.length);
	});

	it('getLocalDistribution: sum to 1', () => {
		const s = createLexical(config, vocab.length, table);
		const dist = s.getLocalDistribution!(0, 0.5);
		let sum = 0;
		for (let i = 0; i < vocab.length; i++) sum += dist[i]!;
		expect(Math.abs(sum - 1)).toBeLessThan(1e-6);
	});

	it('getLocalDistribution: self has zero mass in jump dist when epsilon=0', () => {
		// The jump distribution alone (no stay prob) never puts mass on
		// self because self is excluded from the neighbor table.
		const s = createLexical(config, vocab.length, table);
		const dist = s.getLocalDistribution!(0, 0.5);
		expect(dist[0]).toBe(0);
	});

	it('sampleStep: empty neighbor list falls back to uniform', () => {
		// Build table where one token has no neighbors (maxDistance=0).
		const sparseVocab = ['a', 'ab', 'abcde'];
		const sparseTable = computeNeighborTable(sparseVocab, { maxDistance: 1, k: 5, tau: 1.0 });
		// 'abcde' (id=2, len=5) has no token within distance 1.
		const s = createLexical(config, sparseVocab.length, sparseTable);
		// Assert empty neighbor list.
		expect(sparseTable.offsets[2]).toBe(sparseTable.offsets[3]);
		// coin=0.3 < 0.5 → jump; draw=0.7 → floor(0.7*3)=2.
		const rng = mockRng([0.3, 0.7]);
		expect(s.sampleStep(2, 0.5, rng)).toBe(2);
	});

	it('empirical irreducibility: chain visits diverse tokens', () => {
		// With epsilon=0.1, the ergodicity floor should prevent getting
		// stuck. Run many steps from each starting token and verify we
		// visit different tokens.
		const epsConfig: LexicalConfig = { maxDistance: 2, k: 20, epsilon: 0.1, tau: 1.0 };
		const s = createLexical(epsConfig, vocab.length, table);
		// Use a simple sequential RNG (not actually random in a test, but
		// we care about coverage, not randomness quality).
		let seq = 0;
		const seqRng = () => {
			seq = (seq + 0.37) % 1; // deterministic quasi-random
			return seq;
		};

		for (let start = 0; start < vocab.length; start++) {
			const visited = new Set<number>();
			let token = start;
			for (let step = 0; step < 100; step++) {
				token = s.sampleStep(token, 0.3, seqRng);
				visited.add(token);
			}
			// With epsilon=0.1 and 100 steps at beta=0.3 (~30 jumps),
			// we should visit more than just the start token.
			expect(visited.size).toBeGreaterThan(1);
		}
	});
});