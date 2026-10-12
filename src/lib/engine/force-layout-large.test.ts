import { describe, it, expect } from 'vitest';
import { computeForceLayoutLarge, largeIdealLength } from './force-layout.js';

/** Build a deterministic path graph of `n` nodes. */
function pathGraph(n: number): { src: Int32Array; dst: Int32Array } {
	const src = new Int32Array(n - 1);
	const dst = new Int32Array(n - 1);
	for (let i = 0; i < n - 1; i++) {
		src[i] = i;
		dst[i] = i + 1;
	}
	return { src, dst };
}

describe('computeForceLayoutLarge', () => {
	it('is deterministic for the same inputs', () => {
		const n = 60;
		const { src, dst } = pathGraph(n);
		const a = computeForceLayoutLarge(n, src, dst, null, { iterations: 50 });
		const b = computeForceLayoutLarge(n, src, dst, null, { iterations: 50 });
		expect([...a.x]).toEqual([...b.x]);
		expect([...a.y]).toEqual([...b.y]);
	});

	it('chunked runs (initial continuation) match a single run', () => {
		const n = 80;
		const { src, dst } = pathGraph(n);
		const total = 60;
		const single = computeForceLayoutLarge(n, src, dst, null, { iterations: total });
		let chunked = computeForceLayoutLarge(n, src, dst, null, {
			iterations: 10,
			dampTotal: total,
		});
		for (let done = 10; done < total; done += 10) {
			chunked = computeForceLayoutLarge(n, src, dst, null, {
				iterations: 10,
				initial: chunked,
				iterationOffset: done,
				dampTotal: total,
			});
		}
		expect([...chunked.x]).toEqual([...single.x]);
		expect([...chunked.y]).toEqual([...single.y]);
	});

	it('produces finite positions with edges near the ideal length', () => {
		const n = 60;
		const { src, dst } = pathGraph(n);
		const { x, y } = computeForceLayoutLarge(n, src, dst, null);
		const ideal = largeIdealLength(n);
		for (let i = 0; i < n; i++) {
			expect(Number.isFinite(x[i])).toBe(true);
			expect(Number.isFinite(y[i])).toBe(true);
		}
		let mean = 0;
		for (let e = 0; e < src.length; e++) {
			mean += Math.hypot(x[src[e]!]! - x[dst[e]!]!, y[src[e]!]! - y[dst[e]!]!);
		}
		mean /= src.length;
		expect(mean).toBeLessThan(3 * ideal);
		// No two nodes coincide.
		let minD2 = Infinity;
		for (let i = 0; i < n; i++) {
			for (let j = i + 1; j < n; j++) {
				const d2 = (x[i]! - x[j]!) ** 2 + (y[i]! - y[j]!) ** 2;
				if (d2 < minD2) minD2 = d2;
			}
		}
		expect(minD2).toBeGreaterThan(0.04);
	});

	it('handles disconnected components without NaN or unbounded drift', () => {
		// Four disjoint triangles.
		const n = 12;
		const src = new Int32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
		const dst = new Int32Array([1, 2, 0, 4, 5, 3, 7, 8, 6, 10, 11]);
		const { x, y } = computeForceLayoutLarge(n, src, dst, null, { iterations: 100 });
		let minX = Infinity;
		let maxX = -Infinity;
		let minY = Infinity;
		let maxY = -Infinity;
		for (let i = 0; i < n; i++) {
			minX = Math.min(minX, x[i]!);
			maxX = Math.max(maxX, x[i]!);
			minY = Math.min(minY, y[i]!);
			maxY = Math.max(maxY, y[i]!);
		}
		expect(Number.isFinite(minX) && Number.isFinite(maxY)).toBe(true);
		const ideal = largeIdealLength(n);
		expect(maxX - minX).toBeLessThan(60 * ideal);
		expect(maxY - minY).toBeLessThan(60 * ideal);
	});

	it('lays out 3k nodes with 6k edges within a time budget', () => {
		// Matches real inputs (a 300-token text at T=300 yields ~3k
		// trajectory nodes); random chords make it denser than reality.
		// The budget is generous so slow CI machines don't flake.
		const n = 3_000;
		const m = 6_000;
		const src = new Int32Array(m);
		const dst = new Int32Array(m);
		for (let e = 0; e < m; e++) {
			const a = (e * 2654435761) % n;
			const b = (a + 1 + ((e * 40503) % 7)) % n;
			src[e] = a;
			dst[e] = b;
		}
		const start = performance.now();
		const { x, y } = computeForceLayoutLarge(n, src, dst, null);
		const elapsed = performance.now() - start;
		expect(x.length).toBe(n);
		expect(y.length).toBe(n);
		expect(elapsed).toBeLessThan(20_000);
	}, 30_000);
});
