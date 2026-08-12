import { describe, it, expect } from 'vitest';
import seedrandom from 'seedrandom';
import { createUniform } from './uniform.js';

describe('createUniform', () => {
	const K = 4;
	const strategy = createUniform({}, K);

	it('has correct metadata', () => {
		expect(strategy.info.id).toBe('uniform');
		expect(strategy.info.label).toBe('Uniform');
		expect(strategy.info.stationary).toBe('uniform');
	});

	it('sampleStep with beta=0 is a no-op', () => {
		const rng = () => 0.5;
		for (let token = 0; token < K; token++) {
			expect(strategy.sampleStep(token, 0, rng)).toBe(token);
		}
	});

	it('sampleStep with beta=1 produces uniform marginal over small vocab', () => {
		const K = 4;
		const strategy = createUniform({}, K);

		// Pre-generate values with seedrandom for a proven uniform source.
		const prng = seedrandom.alea('beta1-test');
		const values = new Float32Array(20_000);
		for (let i = 0; i < values.length; i++) {
			values[i] = prng.double();
		}

		let idx = 0;
		const rng = () => values[idx++]!;

		const counts = new Int32Array(K);
		const N = 10_000;
		for (let i = 0; i < N; i++) {
			// With beta=1 the token argument does not matter.
			const next = strategy.sampleStep(0, 1, rng);
			counts[next]!++;
		}

		const expected = N / K;
		for (let k = 0; k < K; k++) {
			expect(counts[k]).toBeGreaterThan(expected * 0.9);
			expect(counts[k]).toBeLessThan(expected * 1.1);
		}
	});

	it('sampleStep draws exactly 2 rng values per call', () => {
		let calls = 0;
		const rng = () => {
			calls++;
			return 0.5;
		};
		strategy.sampleStep(0, 0.5, rng);
		expect(calls).toBe(2);
	});

	it('stationary distribution converges to uniform over $K=4$', () => {
		const K = 4;
		const strategy = createUniform({}, K);
		const beta = 0.5;

		// Pre-generate with seedrandom for a proven uniform source.
		const prng = seedrandom.alea('stationary-test');
		const values = new Float32Array(60_000);
		for (let i = 0; i < values.length; i++) {
			values[i] = prng.double();
		}

		let idx = 0;
		const rng = () => values[idx++]!;

		const counts = new Int32Array(K);
		const samples = 20_000;

		// With beta=0.5 the chain mixes fast; no separate burn-in needed for $K=4$.
		let token = 0;
		for (let i = 0; i < samples; i++) {
			token = strategy.sampleStep(token, beta, rng);
			counts[token]!++;
		}

		const expected = samples / K;
		for (let k = 0; k < K; k++) {
			expect(counts[k]).toBeGreaterThan(expected * 0.85);
			expect(counts[k]).toBeLessThan(expected * 1.15);
		}
	});

	it('getLocalDistribution rows sum to 1', () => {
		for (let token = 0; token < K; token++) {
			const dist = strategy.getLocalDistribution!(token, 0.3);
			const sum = dist.reduce((a, b) => a + b, 0);
			expect(sum).toBeCloseTo(1, 5);
		}
	});

	it('getLocalDistribution matches closed form', () => {
		const beta = 0.3;
		const dist = strategy.getLocalDistribution!(/* token= */ 1, beta);
		const mass = beta / K;

		expect(dist[1]).toBeCloseTo(1 - beta + mass, 5);
		for (let k = 0; k < K; k++) {
			if (k !== 1) {
				expect(dist[k]).toBeCloseTo(mass, 5);
			}
		}
	});
});
