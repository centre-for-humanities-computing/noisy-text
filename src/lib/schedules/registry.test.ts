import { describe, it, expect } from 'vitest';
import { SCHEDULES, getSchedule } from './index.js';

describe('schedule registry', () => {
	it('contains at least one schedule', () => {
		const ids = Object.keys(SCHEDULES);
		expect(ids.length).toBeGreaterThanOrEqual(1);
	});

	it('contains linear, cosine, and constant schedules', () => {
		expect(SCHEDULES.linear).toBeDefined();
		expect(SCHEDULES.cosine).toBeDefined();
		expect(SCHEDULES.constant).toBeDefined();
	});

	it('every entry has the required shape', () => {
		for (const [id, info] of Object.entries(SCHEDULES)) {
			expect(info.id).toBe(id);
			expect(typeof info.label).toBe('string');
			expect(info.label.length).toBeGreaterThan(0);
			expect(typeof info.description).toBe('string');
			expect(info.description.length).toBeGreaterThan(0);
		}
	});

	it('ids are unique', () => {
		const ids = Object.keys(SCHEDULES);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe('getSchedule', () => {
	it('returns an instance for a known id', () => {
		const s = getSchedule('linear', {}, 100);
		expect(s).toBeDefined();
		expect(s.info.id).toBe('linear');
		expect(typeof s.beta).toBe('function');
		expect(typeof s.cumulative).toBe('function');
		expect(s.T).toBe(100);
	});

	it('throws for an unknown id', () => {
		expect(() => getSchedule('nonexistent', {}, 100)).toThrow('Unknown schedule "nonexistent"');
	});

	it('throws for an unknown id (different example)', () => {
		expect(() => getSchedule('exponential', {}, 100)).toThrow('Unknown schedule "exponential"');
	});
});

describe('getSchedule with multiplier', () => {
	it('multiplier 1 is a no-op (returns base schedule)', () => {
		const base = getSchedule('linear', { betaMin: 0.001, betaMax: 0.05 }, 100);
		const scaled = getSchedule('linear', { betaMin: 0.001, betaMax: 0.05, multiplier: 1 }, 100);
		for (let t = 0; t < 100; t++) {
			expect(scaled.beta(t)).toBeCloseTo(base.beta(t), 5);
			expect(scaled.cumulative(t)).toBeCloseTo(base.cumulative(t), 5);
		}
	});

	it('scales beta_t by lambda for the linear schedule', () => {
		const T = 100;
		const lambda = 3;
		const base = getSchedule('linear', { betaMin: 0.001, betaMax: 0.01 }, T);
		const scaled = getSchedule('linear', { betaMin: 0.001, betaMax: 0.01, multiplier: lambda }, T);
		for (let t = 0; t < T; t++) {
			expect(scaled.beta(t)).toBeCloseTo(lambda * base.beta(t), 5);
		}
	});

	it('scales beta_t by lambda for the constant schedule', () => {
		const T = 100;
		const lambda = 2;
		const scaled = getSchedule('constant', { beta: 0.02, multiplier: lambda }, T);
		for (let t = 0; t < T; t++) {
			expect(scaled.beta(t)).toBeCloseTo(0.04, 5);
		}
	});

	it('scales beta_t by lambda for the cosine schedule', () => {
		const T = 100;
		const lambda = 2;
		const base = getSchedule('cosine', {}, T);
		const scaled = getSchedule('cosine', { multiplier: lambda }, T);
		for (let t = 0; t < T; t++) {
			// Near t = T the base beta_t approaches 1, so the scaled value clips.
			const expected = Math.min(lambda * base.beta(t), 1);
			expect(scaled.beta(t)).toBeCloseTo(expected, 5);
		}
	});

	it('clips scaled beta_t to (0, 1)', () => {
		const T = 100;
		const scaled = getSchedule('constant', { beta: 0.4, multiplier: 10 }, T);
		for (let t = 0; t < T; t++) {
			const b = scaled.beta(t);
			expect(b).toBeGreaterThan(0);
			expect(b).toBeLessThanOrEqual(1);
		}
	});

	it('cumulative matches accumulated product of (1 - scaled beta_s)', () => {
		const T = 50;
		const scaled = getSchedule('linear', { betaMin: 0.001, betaMax: 0.01, multiplier: 2 }, T);
		let product = 1;
		for (let t = 0; t < T; t++) {
			product *= 1 - scaled.beta(t);
			expect(scaled.cumulative(t)).toBeCloseTo(product, 5);
		}
	});

	it('cumulative is monotonic non-increasing under scaling', () => {
		const T = 100;
		const scaled = getSchedule('cosine', { multiplier: 5 }, T);
		for (let t = 1; t < T; t++) {
			expect(scaled.cumulative(t)).toBeLessThanOrEqual(scaled.cumulative(t - 1));
			expect(scaled.cumulative(t)).toBeGreaterThanOrEqual(0);
			expect(scaled.cumulative(t)).toBeLessThanOrEqual(1);
		}
	});

	it('keeps base info and T', () => {
		const scaled = getSchedule('linear', { multiplier: 2 }, 100);
		expect(scaled.info.id).toBe('linear');
		expect(scaled.T).toBe(100);
	});

	it('ignores invalid multiplier values (falls back to 1)', () => {
		const s = getSchedule('linear', { multiplier: NaN }, 100);
		expect(s.beta(0)).toBeCloseTo(1e-4, 5);
	});
});
