import { describe, expect, it } from 'vitest';
import { EmbeddingKnnIndex } from './knn-index.js';
import type { QuantizedMatrix, TransformBundle } from './types.js';

/**
 * Build a quantized matrix whose rows sit on a line: row i has value i in
 * every dimension. Then distance order == |i - j| regardless of metric,
 * which makes the expected top-$M$ trivial.
 */
function lineMatrix(K: number, d: number): QuantizedMatrix {
	const codes = new Int8Array(K * d);
	const scales = new Float32Array(K);
	for (let i = 0; i < K; i++) {
		scales[i] = Math.max(1, i) / 127;
		for (let j = 0; j < d; j++) codes[i * d + j] = Math.min(127, i);
	}
	return { codes, scales, vocabSize: K, dim: d };
}

function emptyTransform(d: number, nPcs = 0): TransformBundle {
	return {
		mean: new Float32Array(d),
		pcs: new Float32Array(d * nPcs),
		eigenvalues: new Float32Array(nPcs),
		whitening: identity(d),
	};
}

function identity(d: number): Float32Array {
	const w = new Float32Array(d * d);
	for (let i = 0; i < d; i++) w[i * d + i] = 1;
	return w;
}

describe('EmbeddingKnnIndex.topM', () => {
	const K = 20;
	const d = 4;

	it('returns the M nearest by metric, ascending, self excluded', () => {
		const index = new EmbeddingKnnIndex(lineMatrix(K, d), emptyTransform(d), 'none', 'l2', 5);
		const t = index.topM(10);
		expect(Array.from(t.ids)).toEqual([9, 11, 8, 12, 7]);
		expect(t.dists[0]!).toBeLessThan(t.dists[t.dists.length - 1]!);
		for (const id of t.ids) expect(id).not.toBe(10);
	});

	it('is memoized per token', () => {
		const index = new EmbeddingKnnIndex(lineMatrix(K, d), emptyTransform(d), 'none', 'l2', 5);
		const a = index.topM(3);
		const b = index.topM(3);
		expect(a).toBe(b);
	});

	it('distance is consistent with the ranking', () => {
		const index = new EmbeddingKnnIndex(lineMatrix(K, d), emptyTransform(d), 'none', 'l2', 5);
		const t = index.topM(10);
		for (let i = 1; i < t.ids.length; i++) {
			expect(index.distance(10, t.ids[i - 1]!)).toBeLessThanOrEqual(index.distance(10, t.ids[i]!));
		}
		// Distance to self is 0.
		expect(index.distance(10, 10)).toBeCloseTo(0, 6);
	});

	it('handles M larger than the vocab minus one', () => {
		// L2 on the line matrix gives distinct distances (cosine would make
		// them all 0 and the order arbitrary).
		const index = new EmbeddingKnnIndex(lineMatrix(5, d), emptyTransform(d), 'none', 'l2', 10);
		const t = index.topM(0);
		expect(Array.from(t.ids)).toEqual([1, 2, 3, 4]);
		// Ascending: dequantized row i is $i^2/127$ per dim, so the L2
		// distance from row 0 is $2 i^2 / 127$ — strictly increasing in i.
		for (let i = 1; i < t.dists.length; i++) {
			expect(t.dists[i]!).toBeGreaterThan(t.dists[i - 1]!);
		}
	});

	it('maintains the heap invariant while filling (adversarial order, R1-B1)', () => {
		// d=1 with codes [0,1,5,3,4] makes the insertion order of distances
		// deliberately non-monotone (1, 5, 3, 4 for token 0); the old code
		// never sifted up during filling, producing a corrupt heap and
		// wrong neighbours.
		const K = 5;
		const codes = new Int8Array([0, 1, 5, 3, 4]);
		const scales = new Float32Array(K).fill(1);
		const index = new EmbeddingKnnIndex(
			{ codes, scales, vocabSize: K, dim: 1 },
			emptyTransform(1),
			'none',
			'l2',
			3,
		);
		const t = index.topM(0);
		expect(Array.from(t.ids)).toEqual([1, 3, 4]);
		expect(Array.from(t.dists)).toEqual([1, 3, 4]);
	});

	it('rejects a non-positive m', () => {
		expect(
			() => new EmbeddingKnnIndex(lineMatrix(5, d), emptyTransform(d), 'none', 'l2', 0),
		).toThrow(/m must be a positive integer/);
	});
});

describe('EmbeddingKnnIndex.precomputeRows', () => {
	const K = 12;
	const d = 4;

	it('populates the memo (topM afterwards returns the same table)', async () => {
		const index = new EmbeddingKnnIndex(lineMatrix(K, d), emptyTransform(d), 'none', 'l2', 4);
		await index.precomputeRows(Int32Array.from([2, 7, 9]), undefined);
		const direct = index.topM(7);
		expect(direct.ids.length).toBe(4);
	});

	it('reports progress per chunk', async () => {
		const index = new EmbeddingKnnIndex(lineMatrix(10, d), emptyTransform(d), 'none', 'l2', 3, {
			chunkSize: 4,
		});
		const calls: Array<[number, number]> = [];
		await index.precomputeRows(Int32Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), (done, total) =>
			calls.push([done, total]),
		);
		expect(calls[calls.length - 1]).toEqual([10, 10]);
		expect(calls.length).toBeGreaterThanOrEqual(3);
	});

	it('serves repeat rows from the injected RowCache (R1-N1)', async () => {
		class FakeRowCache {
			store = new Map<string, unknown>();
			puts = 0;
			get(key: string): Promise<unknown> {
				return Promise.resolve(this.store.get(key));
			}
			put(key: string, value: unknown): Promise<void> {
				this.puts++;
				this.store.set(key, value);
				return Promise.resolve();
			}
		}
		const cache = new FakeRowCache();
		const tokens = Int32Array.from([2, 7, 9]);
		const first = new EmbeddingKnnIndex(lineMatrix(K, d), emptyTransform(d), 'none', 'l2', 4, {
			cache,
			cacheKeyPrefix: 'pfx',
		});
		await first.precomputeRows(tokens, undefined);
		expect(cache.puts).toBe(3);

		// A second index over the same cache serves every row without
		// recomputing (no new puts, and the memo is filled from the cache).
		const second = new EmbeddingKnnIndex(lineMatrix(K, d), emptyTransform(d), 'none', 'l2', 4, {
			cache,
			cacheKeyPrefix: 'pfx',
		});
		const computed = await second.precomputeRows(tokens, undefined);
		expect(computed).toBe(0);
		expect(cache.puts).toBe(3);
		expect(second.topM(7).ids.length).toBe(4);
	});
});
