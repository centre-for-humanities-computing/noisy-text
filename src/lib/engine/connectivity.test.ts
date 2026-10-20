import { describe, expect, it } from 'vitest';
import { analyzeConnectivity } from './connectivity.js';

describe('analyzeConnectivity', () => {
	it('single connected component', () => {
		const r = analyzeConnectivity(
			4,
			Int32Array.from([0, 1, 2]),
			Int32Array.from([1, 2, 3]),
			Uint8Array.from([0, 0, 0]),
		);
		expect(r).toEqual({
			componentCount: 1,
			largestComponentSize: 4,
			isolatedCount: 0,
			connected: true,
		});
	});

	it('two clusters are disconnected', () => {
		// Cluster A: 0-1; cluster B: 2-3.
		const r = analyzeConnectivity(
			4,
			Int32Array.from([0, 2]),
			Int32Array.from([1, 3]),
			Uint8Array.from([0, 0]),
		);
		expect(r.componentCount).toBe(2);
		expect(r.largestComponentSize).toBe(2);
		expect(r.isolatedCount).toBe(0);
		expect(r.connected).toBe(false);
	});

	it('isolated nodes count as their own components', () => {
		// Edge 0-1; nodes 2 and 3 have no neighbourhood edges.
		const r = analyzeConnectivity(
			4,
			Int32Array.from([0]),
			Int32Array.from([1]),
			Uint8Array.from([0]),
		);
		expect(r.componentCount).toBe(3);
		expect(r.largestComponentSize).toBe(2);
		expect(r.isolatedCount).toBe(2);
		expect(r.connected).toBe(false);
	});

	it('edges with edgeTraj === 1 are ignored', () => {
		// Only a trajectory edge exists: everything is isolated.
		const r = analyzeConnectivity(
			3,
			Int32Array.from([0, 1]),
			Int32Array.from([1, 2]),
			Uint8Array.from([1, 1]),
		);
		expect(r.componentCount).toBe(3);
		expect(r.isolatedCount).toBe(3);
		expect(r.connected).toBe(false);
	});

	it('empty graph', () => {
		const r = analyzeConnectivity(0, new Int32Array(0), new Int32Array(0), new Uint8Array(0));
		expect(r.componentCount).toBe(0);
		expect(r.connected).toBe(true);
	});
});
