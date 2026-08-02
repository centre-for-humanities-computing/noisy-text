import { describe, it, expect } from 'vitest';
import { getSchedule } from './index.js';

describe('linear schedule', () => {
	it('beta_t is in (0, 1) for all t', () => {
		const T = 100;
		const s = getSchedule('linear', { betaMin: 1e-4, betaMax: 0.02 }, T);
		for (let t = 0; t < T; t++) {
			const b = s.beta(t);
			expect(b).toBeGreaterThan(0);
			expect(b).toBeLessThan(1);
		}
	});

	it('beta_t is monotonic non-decreasing', () => {
		const T = 100;
		const s = getSchedule('linear', { betaMin: 1e-4, betaMax: 0.02 }, T);
		for (let t = 1; t < T; t++) {
			expect(s.beta(t)).toBeGreaterThanOrEqual(s.beta(t - 1));
		}
	});

	it('beta_0 equals betaMin and beta_{T-1} equals betaMax', () => {
		const T = 100;
		const s = getSchedule('linear', { betaMin: 1e-4, betaMax: 0.02 }, T);
		expect(s.beta(0)).toBeCloseTo(1e-4, 5);
		expect(s.beta(T - 1)).toBeCloseTo(0.02, 5);
	});

	it('cumulative is monotonic non-increasing and in [0, 1]', () => {
		const T = 100;
		const s = getSchedule('linear', { betaMin: 1e-4, betaMax: 0.02 }, T);
		expect(s.cumulative(0)).toBeCloseTo(1 - 1e-4, 5);
		for (let t = 1; t < T; t++) {
			const c = s.cumulative(t);
			expect(c).toBeGreaterThanOrEqual(0);
			expect(c).toBeLessThanOrEqual(1);
			expect(c).toBeLessThanOrEqual(s.cumulative(t - 1));
		}
	});

	it('cumulative matches accumulated product of (1 - beta_s)', () => {
		const T = 50;
		const s = getSchedule('linear', { betaMin: 0.001, betaMax: 0.05 }, T);
		let product = 1;
		for (let t = 0; t < T; t++) {
			product *= 1 - s.beta(t);
			expect(s.cumulative(t)).toBeCloseTo(product, 5);
		}
	});

	it('works with T = 1', () => {
		const s = getSchedule('linear', { betaMin: 0.01, betaMax: 0.05 }, 1);
		expect(s.beta(0)).toBeCloseTo(0.01, 5);
		expect(s.cumulative(0)).toBeCloseTo(0.99, 5);
	});

	it('uses defaults when config is empty', () => {
		const s = getSchedule('linear', {}, 100);
		expect(s.beta(0)).toBeCloseTo(1e-4, 5);
		expect(s.beta(99)).toBeCloseTo(0.02, 5);
	});

	it('beta_t is linear in t', () => {
		const T = 100;
		const s = getSchedule('linear', { betaMin: 0, betaMax: 1 }, T);
		// With betaMin=0, betaMax=1: beta_t = t / (T-1)
		for (let t = 0; t < T; t++) {
			expect(s.beta(t)).toBeCloseTo(t / (T - 1), 5);
		}
	});
});
