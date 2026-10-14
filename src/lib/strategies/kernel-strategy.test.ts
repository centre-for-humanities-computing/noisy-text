import { describe, it, expect } from 'vitest';
import { createKernelStrategy } from './kernel-strategy.js';
import { createTokenKernel } from './token-kernel.js';
import { getWeightFamily } from './weight-family.js';
import type { DistanceSource, NeighborTable } from './distance-source.js';
import type { TokenKernel } from './token-kernel.js';
import type { Rng, StrategyInfo } from './types.js';

const INFO: StrategyInfo = {
	id: 'fake-strategy',
	label: 'Fake',
	description: 'fake',
	stationary: 'unknown',
	plainName: 'Fake',
	gloss: 'fake',
	tooltip: { text: 'fake' },
};

/** Deterministic fake source with one neighbor of distance 1 per token. */
function fakeSource(): DistanceSource {
	return {
		id: 'fake',
		params: {},
		vocabSize: 4,
		topK(tokenId: number, _k: number, maxDistance: number): NeighborTable {
			const next = (tokenId + 1) % 4;
			return maxDistance >= 1
				? { ids: Int32Array.from([next]), dists: Float32Array.from([1]) }
				: { ids: new Int32Array(0), dists: new Float32Array(0) };
		},
		distance(a: number, b: number): number {
			return b === (a + 1) % 4 ? 1 : 99;
		},
	};
}

/** Mock RNG cycling through a fixed queue, counting calls. */
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

function fakeKernel(): TokenKernel {
	return createTokenKernel(fakeSource(), getWeightFamily('exponential'), {
		k: 10,
		maxDistance: 3,
		tau: 1.0,
		epsilon: 0,
		vocabSize: 4,
	});
}

describe('createKernelStrategy', () => {
	it('beta = 0 returns the token unchanged', () => {
		const s = createKernelStrategy({
			info: INFO,
			config: {},
			vocabSize: 4,
			kernel: fakeKernel(),
			epsilon: 0,
		});
		const rng = mockRng([0.0, 0.0]); // coin=0 >= beta=0 → stay
		expect(s.sampleStep(2, 0, rng)).toBe(2);
	});

	it('draws exactly 2 rng values with a kernel', () => {
		const s = createKernelStrategy({
			info: INFO,
			config: {},
			vocabSize: 4,
			kernel: fakeKernel(),
			epsilon: 0,
		});
		const rng = mockRng([0.1, 0.5]); // coin jumps, kernel draw
		s.sampleStep(0, 0.5, rng);
		expect(rng.calls()).toBe(2);
	});

	it('draws exactly 2 rng values in the stay branch', () => {
		const s = createKernelStrategy({
			info: INFO,
			config: {},
			vocabSize: 4,
			kernel: fakeKernel(),
			epsilon: 0,
		});
		const rng = mockRng([0.9]); // coin=0.9 >= 0.5 → stay
		s.sampleStep(0, 0.5, rng);
		expect(rng.calls()).toBe(2);
	});

	it('draws exactly 2 rng values with a null kernel', () => {
		const s = createKernelStrategy({
			info: INFO,
			config: {},
			vocabSize: 4,
			kernel: null,
			epsilon: 0,
		});
		const rng = mockRng([0.1, 0.42]); // coin jumps; draw=0.42 → floor(0.42*4)=1
		expect(s.sampleStep(0, 0.5, rng)).toBe(1);
		expect(rng.calls()).toBe(2);
	});

	it('null-kernel jump uses the second draw directly', () => {
		const s = createKernelStrategy({
			info: INFO,
			config: {},
			vocabSize: 4,
			kernel: null,
			epsilon: 0,
		});
		const rng = mockRng([0.1, 0.42]);
		expect(s.sampleStep(0, 0.5, rng)).toBe(Math.floor(0.42 * 4));
	});

	it('jump goes through the kernel', () => {
		const s = createKernelStrategy({
			info: INFO,
			config: {},
			vocabSize: 4,
			kernel: fakeKernel(),
			epsilon: 0,
		});
		// coin=0.1 < 0.5 → jump; draw=0.5 → the single neighbor (id 1).
		const rng = mockRng([0.1, 0.5]);
		expect(s.sampleStep(0, 0.5, rng)).toBe(1);
	});

	it('getLocalDistribution returns the floor-mixed dense jump row', () => {
		const s = createKernelStrategy({
			info: INFO,
			config: {},
			vocabSize: 4,
			kernel: fakeKernel(),
			epsilon: 0.2,
		});
		const dist = s.getLocalDistribution!(0, 0.7); // beta ignored
		let sum = 0;
		for (let i = 0; i < 4; i++) sum += dist[i]!;
		expect(sum).toBeCloseTo(1, 6);
		// Neighbor 1 gets (1 - eps) * 1 + eps/4; others eps/4.
		expect(dist[1]!).toBeCloseTo(0.85, 5);
		expect(dist[0]!).toBeCloseTo(0.05, 5);
		expect(dist[3]!).toBeCloseTo(0.05, 5);
	});

	it('getLocalDistribution is uniform with a null kernel', () => {
		const s = createKernelStrategy({
			info: INFO,
			config: {},
			vocabSize: 4,
			kernel: null,
			epsilon: 0,
		});
		const dist = s.getLocalDistribution!(1, 0.7);
		for (let i = 0; i < 4; i++) expect(dist[i]).toBeCloseTo(0.25, 9);
	});
});
