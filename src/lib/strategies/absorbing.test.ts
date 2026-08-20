import { describe, it, expect } from 'vitest';
import seedrandom from 'seedrandom';
import { createAbsorbing } from './absorbing.js';

describe('createAbsorbing', () => {
	const K = 4;
	const maskTokenId = K; // sentinel = vocabSize
	const strategy = createAbsorbing({ maskTokenId }, K);

	it('has correct metadata', () => {
		expect(strategy.info.id).toBe('absorbing');
		expect(strategy.info.label).toBe('Absorbing (mask)');
		expect(strategy.info.stationary).toBe('point-mass');
	});

	it('sampleStep with beta=0 is a no-op for non-mask tokens', () => {
		const rng = () => 0.5;
		for (let token = 0; token < K; token++) {
			expect(strategy.sampleStep(token, 0, rng)).toBe(token);
		}
	});

	it('sampleStep with beta=0 keeps mask token as mask', () => {
		const rng = () => 0.5;
		expect(strategy.sampleStep(maskTokenId, 0, rng)).toBe(maskTokenId);
	});

	it('sampleStep with beta=1 masks all non-mask tokens in one step', () => {
		const rng = () => 0.5;
		for (let token = 0; token < K; token++) {
			expect(strategy.sampleStep(token, 1, rng)).toBe(maskTokenId);
		}
	});

	it('sampleStep with beta=1 keeps mask token as mask', () => {
		const rng = () => 0.5;
		expect(strategy.sampleStep(maskTokenId, 1, rng)).toBe(maskTokenId);
	});

	it('absorbing: once masked, stays masked for any beta', () => {
		const rng = () => 0;
		for (let beta = 0; beta <= 1; beta += 0.1) {
			expect(strategy.sampleStep(maskTokenId, beta, rng)).toBe(maskTokenId);
		}
	});

	it('sampleStep draws exactly 1 rng value per call', () => {
		let calls = 0;
		const rng = () => {
			calls++;
			return 0.5;
		};
		strategy.sampleStep(0, 0.5, rng);
		expect(calls).toBe(1);
	});

	it('sampleStep draws exactly 1 rng value for mask token too', () => {
		let calls = 0;
		const rng = () => {
			calls++;
			return 0.5;
		};
		strategy.sampleStep(maskTokenId, 0.5, rng);
		expect(calls).toBe(0); // mask token short-circuits, no rng draw
	});

	it('stationary distribution converges to point mass at mask', () => {
		const K = 4;
		const maskTokenId = K;
		const strategy = createAbsorbing({ maskTokenId }, K);
		const beta = 0.3;

		// Pre-generate with seedrandom for a proven uniform source.
		const prng = seedrandom.alea('absorbing-stationary');
		const values = new Float32Array(20_000);
		for (let i = 0; i < values.length; i++) {
			values[i] = prng.double();
		}

		let idx = 0;
		const rng = () => values[idx++]!;

		const counts = new Int32Array(K + 1); // includes sentinel
		const samples = 10_000;

		// Start from token 0 and walk forward.
		let token = 0;
		for (let i = 0; i < samples; i++) {
			token = strategy.sampleStep(token, beta, rng);
			counts[token]!++;
		}

		// After many steps, nearly all mass should be at the mask token.
		expect(counts[maskTokenId]).toBeGreaterThan(samples * 0.99);
	});

	it('at t=T with sufficient schedule, entire sequence is masked', () => {
		const K = 4;
		const maskTokenId = K;
		const strategy = createAbsorbing({ maskTokenId }, K);
		const T = 100;
		const L = 10;

		// Use a constant beta=0.1 — after 100 steps, survival prob is
		// $(1 - 0.1)^{100} \approx 2.7 \times 10^{-5}$, so all tokens
		// should be masked.
		const beta = 0.1;

		const prng = seedrandom.alea('absorbing-full-mask');
		const values = new Float32Array(T * L);
		for (let i = 0; i < values.length; i++) {
			values[i] = prng.double();
		}

		let idx = 0;
		const rng = () => values[idx++]!;

		// Initialize all tokens to 0 (non-mask).
		const tokens = new Int32Array(L);
		tokens.fill(0);

		for (let t = 0; t < T; t++) {
			for (let i = 0; i < L; i++) {
				tokens[i] = strategy.sampleStep(tokens[i]!, beta, rng);
			}
		}

		// After T steps, all tokens should be mask.
		for (let i = 0; i < L; i++) {
			expect(tokens[i]).toBe(maskTokenId);
		}
	});

	it('getLocalDistribution rows sum to 1', () => {
		// Non-mask rows.
		for (let token = 0; token < K; token++) {
			const dist = strategy.getLocalDistribution!(token, 0.3);
			const sum = dist.reduce((a, b) => a + b, 0);
			expect(sum).toBeCloseTo(1, 5);
		}
		// Mask row.
		const dist = strategy.getLocalDistribution!(maskTokenId, 0.3);
		const sum = dist.reduce((a, b) => a + b, 0);
		expect(sum).toBeCloseTo(1, 5);
	});

	it('getLocalDistribution buffer length is vocabSize + 1', () => {
		const dist = strategy.getLocalDistribution!(0, 0.3);
		expect(dist.length).toBe(K + 1);
	});

	it('getLocalDistribution matches closed form for non-mask token', () => {
		const beta = 0.3;
		const dist = strategy.getLocalDistribution!(/* token= */ 1, beta);

		expect(dist[1]).toBeCloseTo(1 - beta, 5);
		expect(dist[maskTokenId]).toBeCloseTo(beta, 5);
		for (let k = 0; k <= K; k++) {
			if (k !== 1 && k !== maskTokenId) {
				expect(dist[k]).toBeCloseTo(0, 5);
			}
		}
	});

	it('getLocalDistribution for mask token is one-hot at mask', () => {
		const dist = strategy.getLocalDistribution!(maskTokenId, 0.3);
		expect(dist[maskTokenId]).toBeCloseTo(1, 5);
		for (let k = 0; k <= K; k++) {
			if (k !== maskTokenId) {
				expect(dist[k]).toBeCloseTo(0, 5);
			}
		}
	});
});
