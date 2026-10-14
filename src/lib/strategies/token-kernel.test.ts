import { describe, it, expect } from 'vitest';
import { createTokenKernel, createUniformKernel, kernelRowToDense } from './token-kernel.js';
import { getWeightFamily } from './weight-family.js';
import type { DistanceSource, NeighborTable } from './distance-source.js';
import type { Rng } from './types.js';

/**
 * Deterministic fake source: neighbors of each token given as
 * `[id, dist]` pairs (already ascending). Distances beyond `maxDistance`
 * are filtered by the kernel via `topK`.
 */
function fakeSource(
	neighbors: Record<number, Array<[number, number]>>,
	vocabSize = 4,
): DistanceSource {
	return {
		id: 'fake',
		params: {},
		vocabSize,
		topK(tokenId: number, k: number, maxDistance: number): NeighborTable {
			const rows = neighbors[tokenId] ?? [];
			const ids: number[] = [];
			const dists: number[] = [];
			for (const [id, dist] of rows) {
				if (ids.length >= k) break;
				if (id === tokenId) continue;
				if (dist > maxDistance) continue;
				ids.push(id);
				dists.push(dist);
			}
			return { ids: Int32Array.from(ids), dists: Float32Array.from(dists) };
		},
		distance(a: number, b: number): number {
			if (a === b) return 0;
			const entry = (neighbors[a] ?? []).find(([id]) => id === b);
			return entry ? entry[1] : 99;
		},
	};
}

/** Mock RNG cycling through a fixed queue. */
function mockRng(values: number[]): Rng & { calls: () => number } {
	let i = 0;
	let count = 0;
	const rng = (): number => {
		count++;
		const v = values[i]!;
		i = (i + 1) % values.length;
		return v;
	};
	return Object.assign(rng, { calls: () => count });
}

const NEIGHBORS: Record<number, Array<[number, number]>> = {
	0: [
		[1, 1],
		[2, 2],
		[3, 3],
	],
	1: [
		[0, 1],
		[2, 1],
	],
	2: [
		[0, 2],
		[1, 1],
	],
	3: [
		[0, 3],
		[1, 2],
	],
};

const PARAMS = { k: 10, maxDistance: 3, tau: 1.0, epsilon: 0, vocabSize: 4 };

describe('createTokenKernel', () => {
	it('getRow sums to 1 and excludes self', () => {
		const kernel = createTokenKernel(fakeSource(NEIGHBORS), getWeightFamily('exponential'), PARAMS);
		for (let token = 0; token < 4; token++) {
			const row = kernel.getRow(token);
			let sum = 0;
			for (let i = 0; i < row.probs.length; i++) sum += row.probs[i]!;
			expect(sum).toBeCloseTo(1, 6);
			expect(row.ids.includes(token)).toBe(false);
		}
	});

	it('getRow applies top-k truncation', () => {
		const kernel = createTokenKernel(fakeSource(NEIGHBORS), getWeightFamily('exponential'), {
			...PARAMS,
			k: 1,
		});
		const row = kernel.getRow(0);
		expect(Array.from(row.ids)).toEqual([1]);
		expect(row.probs[0]).toBeCloseTo(1, 6);
	});

	it('getRow applies maxDistance filtering', () => {
		const kernel = createTokenKernel(fakeSource(NEIGHBORS), getWeightFamily('exponential'), {
			...PARAMS,
			maxDistance: 1,
		});
		const row = kernel.getRow(0);
		expect(Array.from(row.ids)).toEqual([1]);
	});

	it('getRow returns an empty row when nothing is in range', () => {
		const kernel = createTokenKernel(fakeSource(NEIGHBORS), getWeightFamily('exponential'), {
			...PARAMS,
			maxDistance: 0,
		});
		const row = kernel.getRow(0);
		expect(row.ids.length).toBe(0);
		expect(row.probs.length).toBe(0);
	});

	it('getRow memoizes per token (stable identity across calls)', () => {
		const kernel = createTokenKernel(fakeSource(NEIGHBORS), getWeightFamily('exponential'), PARAMS);
		expect(kernel.getRow(0)).toBe(kernel.getRow(0));
	});

	it('sampleStep draws exactly 1 rng value', () => {
		const kernel = createTokenKernel(fakeSource(NEIGHBORS), getWeightFamily('exponential'), PARAMS);
		const rng = mockRng([0.5]);
		kernel.sampleStep(0, rng);
		expect(rng.calls()).toBe(1);
	});

	it('sampleStep: epsilon floor branch selects uniformly', () => {
		const kernel = createTokenKernel(fakeSource(NEIGHBORS), getWeightFamily('exponential'), {
			...PARAMS,
			epsilon: 0.5,
		});
		// draw=0.25 < epsilon=0.5 → floor((0.25/0.5)*4) = 2.
		const rng = mockRng([0.25]);
		expect(kernel.sampleStep(0, rng)).toBe(2);
	});

	it('sampleStep: empty table falls back to uniform over vocab', () => {
		const kernel = createTokenKernel(fakeSource(NEIGHBORS), getWeightFamily('exponential'), {
			...PARAMS,
			maxDistance: 0,
			epsilon: 0,
		});
		// draw=0.7 → floor(0.7*4) = 2.
		const rng = mockRng([0.7]);
		expect(kernel.sampleStep(0, rng)).toBe(2);
	});

	it('sampleStep: tau -> 0 collapses to the nearest neighbor', () => {
		const kernel = createTokenKernel(fakeSource(NEIGHBORS), getWeightFamily('exponential'), {
			...PARAMS,
			tau: 1e-6,
		});
		// v well inside the first (nearest) neighbor's cumulative mass.
		const rng = mockRng([0.5]);
		expect(kernel.sampleStep(0, rng)).toBe(1);
	});

	it('tau = 0 stays finite and matches the MIN_TAU row (tau -> 0 limit)', () => {
		const zero = createTokenKernel(fakeSource(NEIGHBORS), getWeightFamily('exponential'), {
			...PARAMS,
			tau: 0,
		});
		const floored = createTokenKernel(fakeSource(NEIGHBORS), getWeightFamily('exponential'), {
			...PARAMS,
			tau: 1e-6,
		});
		for (let token = 0; token < 4; token++) {
			const row = zero.getRow(token);
			expect(row.ids.length).toBeGreaterThan(0);
			let sum = 0;
			for (let i = 0; i < row.probs.length; i++) {
				expect(Number.isFinite(row.probs[i]!)).toBe(true);
				sum += row.probs[i]!;
			}
			expect(sum).toBeCloseTo(1, 6);
			// Identical to the clamped tiny-tau row.
			expect(Array.from(row.probs)).toEqual(Array.from(floored.getRow(token).probs));
		}
	});

	it('tau = 0 collapses to the nearest neighbor (distinct distances)', () => {
		const kernel = createTokenKernel(fakeSource(NEIGHBORS), getWeightFamily('exponential'), {
			...PARAMS,
			tau: 0,
		});
		const row = kernel.getRow(0);
		expect(row.probs[0]).toBeCloseTo(1, 6);
	});

	it('tau = NaN is clamped and stays finite', () => {
		const kernel = createTokenKernel(fakeSource(NEIGHBORS), getWeightFamily('exponential'), {
			...PARAMS,
			tau: NaN,
		});
		const row = kernel.getRow(0);
		expect(Number.isFinite(row.probs[0]!)).toBe(true);
		expect(row.probs[0]).toBeCloseTo(1, 6);
	});

	it('sampleStep: tau -> infinity is uniform over the top-k neighbors', () => {
		const kernel = createTokenKernel(fakeSource(NEIGHBORS), getWeightFamily('exponential'), {
			...PARAMS,
			tau: 1e9,
		});
		// Uniform over ids [1, 2, 3]: cumulative boundaries at 1/3, 2/3.
		expect(kernel.sampleStep(0, mockRng([0.1]))).toBe(1);
		expect(kernel.sampleStep(0, mockRng([0.4]))).toBe(2);
		expect(kernel.sampleStep(0, mockRng([0.8]))).toBe(3);
	});

	it('sampleStep inverse-CDF matches the row probabilities (power-law)', () => {
		const kernel = createTokenKernel(fakeSource(NEIGHBORS), getWeightFamily('power-law'), PARAMS);
		const row = kernel.getRow(0);
		let cum = 0;
		const draws: number[] = [];
		for (let i = 0; i < row.probs.length; i++) {
			cum += row.probs[i]!;
			draws.push(cum - 1e-9); // just inside each boundary
		}
		for (let i = 0; i < draws.length; i++) {
			expect(kernel.sampleStep(0, mockRng([draws[i]!]))).toBe(row.ids[i]);
		}
	});

	it('logWeight composes family log-weight with source distance', () => {
		const kernel = createTokenKernel(fakeSource(NEIGHBORS), getWeightFamily('exponential'), PARAMS);
		expect(kernel.logWeight?.(0, 2)).toBe(-2);
		expect(kernel.logWeight?.(1, 0)).toBe(-1);
	});
});

describe('createUniformKernel', () => {
	it('sampleStep maps draw directly to a vocab index', () => {
		const kernel = createUniformKernel(4, 0);
		expect(kernel.sampleStep(0, mockRng([0.7]))).toBe(2);
		expect(kernel.sampleStep(3, mockRng([0.999]))).toBe(3);
	});

	it('sampleStep with epsilon floor scales the draw by 1/epsilon', () => {
		const kernel = createUniformKernel(4, 0.5);
		// draw=0.25 < 0.5 → floor((0.25/0.5)*4) = 2.
		expect(kernel.sampleStep(0, mockRng([0.25]))).toBe(2);
		// draw=0.75 ≥ 0.5 → floor(0.75*4) = 3.
		expect(kernel.sampleStep(0, mockRng([0.75]))).toBe(3);
	});

	it('getRow is uniform over the vocab', () => {
		const kernel = createUniformKernel(4, 0);
		const row = kernel.getRow(2);
		expect(Array.from(row.ids)).toEqual([0, 1, 2, 3]);
		for (let i = 0; i < 4; i++) expect(row.probs[i]).toBeCloseTo(0.25, 6);
	});
});

describe('kernelRowToDense', () => {
	it('mixes (1 - epsilon) * row with the epsilon floor', () => {
		const dist = new Float32Array(4);
		const row = { ids: Int32Array.from([1, 2]), probs: Float32Array.from([0.75, 0.25]) };
		kernelRowToDense(dist, row, 0.2, 4);
		// Float32Array storage: ~7 significant digits.
		expect(dist[0]).toBeCloseTo(0.2 / 4, 7);
		expect(dist[1]).toBeCloseTo(0.8 * 0.75 + 0.2 / 4, 7);
		expect(dist[2]).toBeCloseTo(0.8 * 0.25 + 0.2 / 4, 7);
		expect(dist[3]).toBeCloseTo(0.2 / 4, 7);
		let sum = 0;
		for (let i = 0; i < 4; i++) sum += dist[i]!;
		expect(sum).toBeCloseTo(1, 6);
	});

	it('epsilon = 0 gives the bare kernel row', () => {
		const dist = new Float32Array(4);
		const row = { ids: Int32Array.from([1, 2]), probs: Float32Array.from([0.75, 0.25]) };
		kernelRowToDense(dist, row, 0, 4);
		expect(dist[0]).toBe(0);
		expect(dist[1]).toBeCloseTo(0.75, 9);
		expect(dist[2]).toBeCloseTo(0.25, 9);
		expect(dist[3]).toBe(0);
	});

	it('empty row normalizes to uniform (every dense row sums to 1)', () => {
		const dist = new Float32Array(4);
		const row = { ids: new Int32Array(0), probs: new Float32Array(0) };
		kernelRowToDense(dist, row, 0, 4);
		for (let i = 0; i < 4; i++) expect(dist[i]).toBeCloseTo(0.25, 9);
	});
});
