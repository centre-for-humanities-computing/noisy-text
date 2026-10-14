import { describe, expect, it } from 'vitest';
import { metricDistance } from './metric.js';

describe('metricDistance', () => {
	it('cosine: known values', () => {
		expect(
			metricDistance(new Float32Array([1, 0]), new Float32Array([0, 1]), 'cosine'),
		).toBeCloseTo(1, 6);
		expect(
			metricDistance(new Float32Array([1, 0]), new Float32Array([2, 0]), 'cosine'),
		).toBeCloseTo(0, 6);
		expect(
			metricDistance(new Float32Array([1, 0]), new Float32Array([-1, 0]), 'cosine'),
		).toBeCloseTo(2, 6);
	});

	it('cosine: identical vectors -> 0; zero vector -> 1', () => {
		const a = new Float32Array([0.3, -1.2, 5]);
		expect(metricDistance(a, a, 'cosine')).toBeCloseTo(0, 6);
		expect(metricDistance(new Float32Array(3), a, 'cosine')).toBe(1);
	});

	it('l2: known values', () => {
		expect(metricDistance(new Float32Array([0, 0]), new Float32Array([3, 4]), 'l2')).toBeCloseTo(
			5,
			6,
		);
		const a = new Float32Array([1, 2, 3]);
		expect(metricDistance(a, a, 'l2')).toBeCloseTo(0, 6);
	});
});
