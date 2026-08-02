import { describe, it, expect } from 'vitest';
import { getSchedule } from './index.js';

describe('cosine schedule', () => {
	it('beta_t is in (0, 1) for all t', () => {
		const T = 100;
		const s = getSchedule('cosine', {}, T);
		for (let t = 0; t < T; t++) {
			const b = s.beta(t);
			expect(b).toBeGreaterThan(0);
			expect(b).toBeLessThan(1);
		}
	});

	it('cumulative is monotonic non-increasing and in [0, 1]', () => {
		const T = 100;
		const s = getSchedule('cosine', {}, T);
		expect(s.cumulative(0)).toBeGreaterThan(0.99); // near 1 at start
		for (let t = 1; t < T; t++) {
			const c = s.cumulative(t);
			expect(c).toBeGreaterThanOrEqual(0);
			expect(c).toBeLessThanOrEqual(1);
			expect(c).toBeLessThanOrEqual(s.cumulative(t - 1));
		}
	});

	it('cumulative approaches 0 at the end', () => {
		const T = 1000;
		const s = getSchedule('cosine', {}, T);
		expect(s.cumulative(T - 1)).toBeLessThan(0.01);
	});

	it('beta_t matches closed-form alpha_bar ratio', () => {
		const T = 100;
		const s = getSchedule('cosine', {}, T);
		// $\beta_t = 1 - \bar\alpha_t / \bar\alpha_{t-1}$
		for (let t = 1; t < T; t++) {
			const expected = 1 - s.cumulative(t) / s.cumulative(t - 1);
			expect(s.beta(t)).toBeCloseTo(expected, 5);
		}
	});

	it('beta_0 = 1 - alpha_bar_0', () => {
		const T = 100;
		const s = getSchedule('cosine', {}, T);
		expect(s.beta(0)).toBeCloseTo(1 - s.cumulative(0), 5);
	});

	it('works with T = 1', () => {
		const s = getSchedule('cosine', {}, 1);
		expect(s.beta(0)).toBeGreaterThan(0);
		expect(s.beta(0)).toBeLessThan(1);
		// With T=1, alpha_bar_0 = f(0)/f(0) = 1.
		expect(s.cumulative(0)).toBe(1);
	});

	it('preserves more signal early than linear with comparable beta range', () => {
		// Cosine should have higher alpha_bar at t = T/2 than linear
		// when both use comparable beta ranges and T is large enough.
		const T = 1000;
		const cosine = getSchedule('cosine', {}, T);
		const linear = getSchedule('linear', { betaMin: 1e-4, betaMax: 0.02 }, T);
		const mid = Math.floor(T / 2);
		expect(cosine.cumulative(mid)).toBeGreaterThan(linear.cumulative(mid));
	});
});
