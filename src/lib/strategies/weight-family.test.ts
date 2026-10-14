import { describe, it, expect } from 'vitest';
import {
	WEIGHT_FAMILIES,
	getWeightFamily,
	isWeightFamilyId,
	MIN_TAU,
	clampTau,
} from './weight-family.js';
import type { WeightFamily } from './weight-family.js';

const FAMILIES: WeightFamily[] = Object.values(WEIGHT_FAMILIES);

describe('weight families', () => {
	it('exposes exactly the three documented families', () => {
		expect(Object.keys(WEIGHT_FAMILIES).sort()).toEqual(['exponential', 'gaussian', 'power-law']);
	});

	it.each([
		['exponential', 1, 1, Math.exp(-1)],
		['power-law', 1, 1, Math.pow(2, -1)],
		['gaussian', 1, 1, Math.exp(-0.5)],
	] as const)('%s weight matches its closed form', (id, dist, tau, expected) => {
		expect(WEIGHT_FAMILIES[id].weight(dist, tau)).toBeCloseTo(expected, 12);
	});

	it('exponential logWeight is exactly $-d/\\tau$ (legacy softmax fidelity)', () => {
		for (let d = 0; d <= 10; d += 0.25) {
			for (const tau of [0.05, 0.3, 1.0, 2.5]) {
				expect(WEIGHT_FAMILIES.exponential.logWeight(d, tau)).toBe(-d / tau);
			}
		}
	});

	it('each family is monotone decreasing in dist', () => {
		for (const family of FAMILIES) {
			let prev = family.weight(0, 1.0);
			for (let d = 0.25; d <= 5; d += 0.25) {
				const w = family.weight(d, 1.0);
				expect(w).toBeLessThan(prev);
				prev = w;
			}
		}
	});

	it('weights are finite at dist = 0 for every family and small tau', () => {
		for (const family of FAMILIES) {
			for (const tau of [0.05, 0.5, 5]) {
				const w = family.weight(0, tau);
				expect(Number.isFinite(w)).toBe(true);
				expect(w).toBeGreaterThan(0);
			}
		}
	});

	it('tau -> 0 concentrates weight on the smallest distance', () => {
		const dists = [1, 2, 5];
		for (const family of FAMILIES) {
			const tau = 1e-3;
			const logW = dists.map((d) => family.logWeight(d, tau));
			const maxLogit = Math.max(...logW);
			const sumExp = logW.reduce((acc, l) => acc + Math.exp(l - maxLogit), 0);
			const probs = logW.map((l) => Math.exp(l - maxLogit) / sumExp);
			expect(probs[0]!).toBeCloseTo(1, 6);
			expect(probs[1]!).toBeCloseTo(0, 6);
			expect(probs[2]!).toBeCloseTo(0, 6);
		}
	});

	it('large tau flattens weight ratios to 1 (uniform over the table)', () => {
		const dists = [0, 1, 4];
		for (const family of FAMILIES) {
			const tau = 1e6;
			const w = dists.map((d) => family.weight(d, tau));
			// Ratios are 1 - O(d/tau); 1e-6-scale deviations are expected.
			expect(w[1]! / w[0]!).toBeCloseTo(1, 5);
			expect(w[2]! / w[0]!).toBeCloseTo(1, 5);
		}
	});

	it('logWeight and weight agree up to log', () => {
		for (const family of FAMILIES) {
			for (let d = 0; d <= 4; d += 0.5) {
				for (const tau of [0.1, 1.0, 4.0]) {
					const w = family.weight(d, tau);
					// Skip double-precision underflow (weight = 0); logWeight
					// is the accurate path there by design.
					if (w === 0) continue;
					expect(family.logWeight(d, tau)).toBeCloseTo(Math.log(w), 9);
				}
			}
		}
	});
});

describe('getWeightFamily', () => {
	it('returns the family for a known id', () => {
		expect(getWeightFamily('gaussian').id).toBe('gaussian');
	});

	it('throws on an unknown id', () => {
		expect(() => getWeightFamily('linear')).toThrow('Unknown weight family "linear"');
	});

	it('rejects inherited Object.prototype keys', () => {
		expect(() => getWeightFamily('toString')).toThrow('Unknown weight family "toString"');
		expect(() => getWeightFamily('constructor')).toThrow('Unknown weight family "constructor"');
	});
});

describe('isWeightFamilyId', () => {
	it('accepts known ids', () => {
		expect(isWeightFamilyId('exponential')).toBe(true);
		expect(isWeightFamilyId('power-law')).toBe(true);
		expect(isWeightFamilyId('gaussian')).toBe(true);
	});

	it('rejects unknown ids', () => {
		expect(isWeightFamilyId('linear')).toBe(false);
		expect(isWeightFamilyId('')).toBe(false);
	});

	it('rejects inherited Object.prototype keys', () => {
		expect(isWeightFamilyId('toString')).toBe(false);
		expect(isWeightFamilyId('constructor')).toBe(false);
		expect(isWeightFamilyId('hasOwnProperty')).toBe(false);
	});
});

describe('clampTau', () => {
	it('passes through strictly positive finite temperatures', () => {
		expect(clampTau(2)).toBe(2);
		expect(clampTau(0.05)).toBe(0.05);
		expect(clampTau(1e-5)).toBe(1e-5);
	});

	it('floors zero, negatives, and non-finite values to MIN_TAU', () => {
		for (const tau of [0, -1, -1e-9, NaN, Infinity, -Infinity]) {
			expect(clampTau(tau)).toBe(MIN_TAU);
		}
	});

	it('floors tau = MIN_TAU exactly (boundary is inclusive)', () => {
		expect(clampTau(MIN_TAU)).toBe(MIN_TAU);
	});
});
