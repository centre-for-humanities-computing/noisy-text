import { describe, it, expect } from 'vitest';
import {
	resolveNeighbors,
	sampleFromResolved,
	fillLocalDistribution,
	applyLimit,
} from './neighbor-softmax.js';

describe('resolveNeighbors', () => {
	const neighbors = [
		{ id: 1, dist: 0.2 },
		{ id: 2, dist: 0.3 },
		{ id: 3, dist: 0.5 },
		{ id: 4, dist: 0.8 },
		{ id: 5, dist: 1.0 },
	];

	it('filters by maxDistance', () => {
		const r = resolveNeighbors(neighbors, 0.4, 20, 1.0);
		expect(r).not.toBeNull();
		expect(r!.entries.length).toBe(2);
		expect(r!.entries[0]!.id).toBe(1);
		expect(r!.entries[1]!.id).toBe(2);
	});

	it('truncates to top-k', () => {
		const r = resolveNeighbors(neighbors, 1.0, 2, 1.0);
		expect(r).not.toBeNull();
		expect(r!.entries.length).toBe(2);
	});

	it('returns null when no neighbors pass filter', () => {
		const r = resolveNeighbors(neighbors, 0.1, 20, 1.0);
		expect(r).toBeNull();
	});

	it('returns null for empty input', () => {
		const r = resolveNeighbors([], 1.0, 20, 1.0);
		expect(r).toBeNull();
	});

	it('weights sum to 1', () => {
		const r = resolveNeighbors(neighbors, 1.0, 20, 1.0);
		expect(r).not.toBeNull();
		let sum = 0;
		for (let i = 0; i < r!.weights.length; i++) sum += r!.weights[i]!;
		expect(Math.abs(sum - 1)).toBeLessThan(1e-6);
	});

	it('closer distances get higher weights', () => {
		const r = resolveNeighbors(neighbors, 1.0, 20, 1.0);
		expect(r).not.toBeNull();
		// id=1 (dist=0.2) should have higher weight than id=5 (dist=1.0).
		expect(r!.weights[0]!).toBeGreaterThan(r!.weights[4]!);
	});

	it('tau controls sharpness', () => {
		// Low tau → sharper (more concentrated on closest).
		const rLow = resolveNeighbors(neighbors, 1.0, 20, 0.1);
		const rHigh = resolveNeighbors(neighbors, 1.0, 20, 10.0);
		expect(rLow).not.toBeNull();
		expect(rHigh).not.toBeNull();
		expect(rLow!.weights[0]!).toBeGreaterThan(rHigh!.weights[0]!);
	});
});

describe('sampleFromResolved', () => {
	const resolved = resolveNeighbors(
		[
			{ id: 10, dist: 0.1 },
			{ id: 20, dist: 0.5 },
			{ id: 30, dist: 0.9 },
		],
		1.0,
		20,
		1.0,
	)!;

	it('draw=0 returns first (closest) neighbor', () => {
		expect(sampleFromResolved(resolved, 0, 0, 100)).toBe(10);
	});

	it('draw just below first weight returns first neighbor', () => {
		const w0 = resolved.weights[0]!;
		expect(sampleFromResolved(resolved, w0 * 0.5, 0, 100)).toBe(10);
	});

	it('draw=1-eps returns last neighbor', () => {
		expect(sampleFromResolved(resolved, 0.9999, 0, 100)).toBe(30);
	});

	it('uniform floor: draw < epsilon selects from floor', () => {
		// epsilon=0.5, draw=0.2 → floor branch.
		// scaled = 0.2/0.5 = 0.4 → floor(0.4*100) = 40.
		expect(sampleFromResolved(resolved, 0.2, 0.5, 100)).toBe(40);
	});

	it('uniform floor: draw=0 returns 0', () => {
		expect(sampleFromResolved(resolved, 0, 0.5, 100)).toBe(0);
	});

	it('uniform floor: draw just below epsilon returns vocabSize-1', () => {
		// epsilon=0.5, draw=0.4999 → scaled ≈ 0.9998 → floor(0.9998*100)=99.
		expect(sampleFromResolved(resolved, 0.4999, 0.5, 100)).toBe(99);
	});
});

describe('fillLocalDistribution', () => {
	const resolved = resolveNeighbors(
		[
			{ id: 1, dist: 0.1 },
			{ id: 3, dist: 0.5 },
		],
		1.0,
		20,
		1.0,
	)!;
	const K = 5;

	it('fills neighbor positions with (1-epsilon)*weight', () => {
		const dist = new Float32Array(K);
		fillLocalDistribution(dist, resolved, 0, K);
		expect(dist[1]).toBeGreaterThan(0);
		expect(dist[3]).toBeGreaterThan(0);
		expect(dist[0]).toBe(0);
		expect(dist[2]).toBe(0);
		expect(dist[4]).toBe(0);
	});

	it('sums to 1', () => {
		const dist = new Float32Array(K);
		fillLocalDistribution(dist, resolved, 0.1, K);
		let sum = 0;
		for (let i = 0; i < K; i++) sum += dist[i]!;
		expect(Math.abs(sum - 1)).toBeLessThan(1e-6);
	});

	it('adds uniform floor when epsilon > 0', () => {
		const dist = new Float32Array(K);
		fillLocalDistribution(dist, resolved, 0.5, K);
		// Every position should have at least epsilon/K = 0.1.
		for (let i = 0; i < K; i++) {
			expect(dist[i]).toBeGreaterThanOrEqual(0.099);
		}
	});

	it('self has zero mass when epsilon=0', () => {
		const dist = new Float32Array(K);
		fillLocalDistribution(dist, resolved, 0, K);
		expect(dist[0]).toBe(0);
	});
});

describe('applyLimit', () => {
	const neighbors = [
		{ id: 1, dist: 0.2 },
		{ id: 2, dist: 0.3 },
		{ id: 3, dist: 0.5 },
		{ id: 4, dist: 0.8 },
		{ id: 5, dist: 1.0 },
	];

	it('returns null for null input', () => {
		expect(applyLimit(null, 'top-k', 5, 0.95)).toBeNull();
	});

	it('top-k truncates and renormalizes', () => {
		const r = resolveNeighbors(neighbors, 1.0, 20, 1.0);
		const limited = applyLimit(r, 'top-k', 2, 0.95);
		expect(limited).not.toBeNull();
		expect(limited!.entries.length).toBe(2);
		let sum = 0;
		for (let i = 0; i < limited!.weights.length; i++) sum += limited!.weights[i]!;
		expect(Math.abs(sum - 1)).toBeLessThan(1e-6);
	});

	it('top-k larger than list keeps everything', () => {
		const r = resolveNeighbors(neighbors, 1.0, 20, 1.0);
		const limited = applyLimit(r, 'top-k', 100, 0.95);
		expect(limited).not.toBeNull();
		expect(limited!.entries.length).toBe(5);
	});

	it('top-p keeps smallest prefix reaching p', () => {
		const r = resolveNeighbors(neighbors, 1.0, 20, 1.0);
		// With tau=1 the weights decay; p=0.5 should keep fewer than all 5.
		const limited = applyLimit(r, 'top-p', 100, 0.5);
		expect(limited).not.toBeNull();
		expect(limited!.entries.length).toBeLessThan(5);
		expect(limited!.entries.length).toBeGreaterThanOrEqual(1);
	});

	it('top-p always keeps at least one entry', () => {
		const r = resolveNeighbors(neighbors, 1.0, 20, 1.0);
		const limited = applyLimit(r, 'top-p', 100, 0.0001);
		expect(limited).not.toBeNull();
		expect(limited!.entries.length).toBe(1);
	});

	it('top-p with p=1 keeps everything', () => {
		const r = resolveNeighbors(neighbors, 1.0, 20, 1.0);
		const limited = applyLimit(r, 'top-p', 100, 1.0);
		expect(limited).not.toBeNull();
		expect(limited!.entries.length).toBe(5);
	});

	it('top-p renormalizes weights to sum 1', () => {
		const r = resolveNeighbors(neighbors, 1.0, 20, 1.0);
		const limited = applyLimit(r, 'top-p', 100, 0.7);
		expect(limited).not.toBeNull();
		let sum = 0;
		for (let i = 0; i < limited!.weights.length; i++) sum += limited!.weights[i]!;
		expect(Math.abs(sum - 1)).toBeLessThan(1e-6);
	});

	it('returns null when resolved is empty', () => {
		const r = resolveNeighbors([], 1.0, 20, 1.0);
		expect(applyLimit(r, 'top-k', 5, 0.95)).toBeNull();
	});
});
