import { describe, expect, it } from 'vitest';
import { EmbeddingDistanceModel } from './embedding-distance-model.js';
import { EmbeddingKnnIndex } from './knn-index.js';
import type { QuantizedMatrix, TransformBundle } from './types.js';

/** Rows on a line (value i per dim) so distance order == |i - j| under L2. */
function lineMatrix(K: number, d: number): QuantizedMatrix {
	const codes = new Int8Array(K * d);
	const scales = new Float32Array(K);
	for (let i = 0; i < K; i++) {
		scales[i] = Math.max(1, i) / 127;
		for (let j = 0; j < d; j++) codes[i * d + j] = Math.min(127, i);
	}
	return { codes, scales, vocabSize: K, dim: d };
}

function emptyTransform(d: number): TransformBundle {
	const w = new Float32Array(d * d);
	for (let i = 0; i < d; i++) w[i * d + i] = 1;
	return {
		mean: new Float32Array(d),
		pcs: new Float32Array(0),
		eigenvalues: new Float32Array(0),
		whitening: w,
	};
}

function makeModel(K: number, d: number, m: number, predicate: (id: number) => boolean) {
	const index = new EmbeddingKnnIndex(lineMatrix(K, d), emptyTransform(d), 'none', 'l2', m);
	return {
		index,
		model: new EmbeddingDistanceModel(index, predicate, 'test-source', 'none', 'l2'),
	};
}

describe('EmbeddingDistanceModel', () => {
	it('exposes the kNN id and vocab size', () => {
		const { model } = makeModel(10, 4, 5, () => true);
		expect(model.id).toBe('embedding:test-source:none:l2');
		expect(model.K).toBe(10);
	});

	it('candidates are filtered by the predicate', () => {
		// Only even ids admissible; m=8 must yield the even neighbours only.
		const { model } = makeModel(20, 2, 8, (id) => id % 2 === 0);
		const got = Array.from(model.candidates(10, Infinity));
		expect(got.length).toBeGreaterThan(0);
		for (const j of got) expect(j % 2).toBe(0);
		expect(got).not.toContain(10);
	});

	it('distance returns the true distance within maxDist, else maxDist + 1', () => {
		const { model } = makeModel(10, 2, 9, () => true);
		// Rows are on a line: L2 distance between row 1 and row 4 is 3·v.
		const d14 = model.distance(1, 4, Infinity);
		expect(d14).toBeGreaterThan(0);
		expect(model.distance(1, 4, d14)).toBe(d14);
		expect(model.distance(1, 4, d14 / 2)).toBe(d14 / 2 + 1);
	});

	it('distance is symmetric', () => {
		const { model } = makeModel(10, 2, 9, () => true);
		expect(model.distance(2, 7, Infinity)).toBeCloseTo(model.distance(7, 2, Infinity), 6);
	});
});
