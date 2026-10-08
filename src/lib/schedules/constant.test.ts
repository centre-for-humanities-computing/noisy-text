import { describe, it, expect } from 'vitest';
import { getSchedule } from './index.js';

describe('constant schedule', () => {
	it('beta_t is constant and in (0, 1) for all t', () => {
		const T = 100;
		const s = getSchedule('constant', { beta: 0.02 }, T);
		for (let t = 0; t < T; t++) {
			expect(s.beta(t)).toBeCloseTo(0.02, 5);
			expect(s.beta(t)).toBeGreaterThan(0);
			expect(s.beta(t)).toBeLessThan(1);
		}
	});

	it('cumulative matches the closed form (1 - beta)^(t+1)', () => {
		const T = 50;
		const beta = 0.05;
		const s = getSchedule('constant', { beta }, T);
		for (let t = 0; t < T; t++) {
			expect(s.cumulative(t)).toBeCloseTo((1 - beta) ** (t + 1), 5);
		}
	});

	it('cumulative is monotonic non-increasing and in [0, 1]', () => {
		const T = 100;
		const s = getSchedule('constant', { beta: 0.02 }, T);
		for (let t = 1; t < T; t++) {
			const c = s.cumulative(t);
			expect(c).toBeGreaterThanOrEqual(0);
			expect(c).toBeLessThanOrEqual(1);
			expect(c).toBeLessThanOrEqual(s.cumulative(t - 1));
		}
	});

	it('cumulative matches accumulated product of (1 - beta_s)', () => {
		const T = 50;
		const beta = 0.01;
		const s = getSchedule('constant', { beta }, T);
		let product = 1;
		for (let t = 0; t < T; t++) {
			product *= 1 - beta;
			expect(s.cumulative(t)).toBeCloseTo(product, 5);
		}
	});

	it('works with T = 1', () => {
		const s = getSchedule('constant', { beta: 0.02 }, 1);
		expect(s.beta(0)).toBeCloseTo(0.02, 5);
		expect(s.cumulative(0)).toBeCloseTo(0.98, 5);
	});

	it('uses defaults when config is empty', () => {
		const s = getSchedule('constant', {}, 100);
		expect(s.beta(0)).toBeCloseTo(0.02, 5);
	});
});
