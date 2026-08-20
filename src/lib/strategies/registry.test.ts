import { describe, it, expect } from 'vitest';
import { STRATEGIES, getStrategy, strategyConfigFor } from './index.js';

const VALID_STATIONARY_VALUES = new Set(['uniform', 'point-mass', 'data-dependent', 'unknown']);

describe('strategy registry', () => {
	it('contains at least one strategy', () => {
		const ids = Object.keys(STRATEGIES);
		expect(ids.length).toBeGreaterThanOrEqual(1);
	});

	it('contains the identity strategy', () => {
		expect(STRATEGIES.identity).toBeDefined();
	});

	it('contains the absorbing strategy', () => {
		const info = STRATEGIES['absorbing'];
		expect(info).toBeDefined();
		expect(info!.id).toBe('absorbing');
	});

	it('every entry has the required shape', () => {
		for (const [id, info] of Object.entries(STRATEGIES)) {
			expect(info.id).toBe(id);
			expect(typeof info.label).toBe('string');
			expect(info.label.length).toBeGreaterThan(0);
			expect(typeof info.description).toBe('string');
			expect(info.description.length).toBeGreaterThan(0);
			expect(VALID_STATIONARY_VALUES.has(info.stationary)).toBe(true);
		}
	});

	it('ids are unique', () => {
		const ids = Object.keys(STRATEGIES);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe('getStrategy', () => {
	it('returns an instance for a known id', () => {
		const s = getStrategy('identity', {}, 100);
		expect(s).toBeDefined();
		expect(s.info.id).toBe('identity');
		expect(typeof s.sampleStep).toBe('function');
	});

	it('throws for an unknown id', () => {
		expect(() => getStrategy('nonexistent', {}, 100)).toThrow('Unknown strategy "nonexistent"');
	});

	it('throws for an unknown id (different example)', () => {
		expect(() => getStrategy('mask', {}, 100)).toThrow('Unknown strategy "mask"');
	});

	it('returns an instance for the absorbing strategy', () => {
		const s = getStrategy('absorbing', { maskTokenId: 100 }, 100);
		expect(s).toBeDefined();
		expect(s.info.id).toBe('absorbing');
		expect(typeof s.sampleStep).toBe('function');
	});
});

describe('strategyConfigFor', () => {
	it('returns empty config for identity', () => {
		expect(strategyConfigFor('identity', 100)).toEqual({});
	});

	it('returns empty config for uniform', () => {
		expect(strategyConfigFor('uniform', 100)).toEqual({});
	});

	it('returns maskTokenId config for absorbing', () => {
		expect(strategyConfigFor('absorbing', 100)).toEqual({ maskTokenId: 100 });
	});
});

describe('identity strategy behavior', () => {
	it('sampleStep returns the input token', () => {
		const s = getStrategy('identity', {}, 50);
		const rng = Math.random;
		for (let token = 0; token < 50; token++) {
			expect(s.sampleStep(token, 0.01, rng)).toBe(token);
			expect(s.sampleStep(token, 0.5, rng)).toBe(token);
			expect(s.sampleStep(token, 0.99, rng)).toBe(token);
		}
	});

	it('getLocalDistribution returns a one-hot vector', () => {
		const vocabSize = 10;
		const s = getStrategy('identity', {}, vocabSize);
		const dist = s.getLocalDistribution!(3, 0.01);
		expect(dist).toBeInstanceOf(Float32Array);
		expect(dist.length).toBe(vocabSize);
		expect(dist[3]).toBe(1);
		for (let j = 0; j < vocabSize; j++) {
			if (j !== 3) expect(dist[j]).toBe(0);
		}
	});

	it('getLocalDistribution sums to 1', () => {
		const s = getStrategy('identity', {}, 20);
		for (let token = 0; token < 20; token++) {
			const dist = s.getLocalDistribution!(token, 0.01);
			const sum = dist.reduce((a, b) => a + b, 0);
			expect(sum).toBeCloseTo(1, 5);
		}
	});
});
