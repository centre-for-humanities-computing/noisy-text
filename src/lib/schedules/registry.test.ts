import { describe, it, expect } from 'vitest';
import { SCHEDULES, getSchedule } from './index.js';

describe('schedule registry', () => {
	it('contains at least one schedule', () => {
		const ids = Object.keys(SCHEDULES);
		expect(ids.length).toBeGreaterThanOrEqual(1);
	});

	it('contains linear and cosine schedules', () => {
		expect(SCHEDULES.linear).toBeDefined();
		expect(SCHEDULES.cosine).toBeDefined();
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
