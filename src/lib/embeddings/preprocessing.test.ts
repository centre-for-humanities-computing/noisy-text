import { describe, expect, it } from 'vitest';
import { applyPreprocess } from './preprocessing.js';
import type { TransformBundle } from './types.js';

/** Build a transform bundle with mean, a rank-1 PC basis, and an identity whitening. */
function makeTransform(d: number, nPcs: number): TransformBundle {
	const mean = new Float32Array(d);
	for (let i = 0; i < d; i++) mean[i] = 0.1 * i;
	const pcs = new Float32Array(d * nPcs);
	for (let i = 0; i < d; i++) pcs[i * nPcs] = 1 / Math.sqrt(d); // first PC = constant dir
	const eigenvalues = new Float32Array(nPcs);
	for (let p = 0; p < nPcs; p++) eigenvalues[p] = 1;
	return { mean, pcs, eigenvalues, whitening: identity(d) };
}

function identity(d: number): Float32Array {
	const w = new Float32Array(d * d);
	for (let i = 0; i < d; i++) w[i * d + i] = 1;
	return w;
}

describe('applyPreprocess', () => {
	const d = 8;
	const t = makeTransform(d, 3);
	const vec = new Float32Array(d).map((_, i) => Math.sin(i) * 3);

	it('none copies the input', () => {
		const out = new Float32Array(d);
		applyPreprocess(vec, out, 'none', t);
		expect(Array.from(out)).toEqual(Array.from(vec));
	});

	it('mean-center subtracts the mean', () => {
		const out = new Float32Array(d);
		applyPreprocess(vec, out, 'mean-center', t);
		for (let i = 0; i < d; i++) expect(out[i]).toBeCloseTo(vec[i]! - t.mean[i]!, 6);
	});

	it('center-remove-pcs removes the top PC direction', () => {
		const out = new Float32Array(d);
		applyPreprocess(vec, out, 'center-remove-pcs', t);
		// First PC is the constant direction; its projection must vanish.
		let proj = 0;
		for (let i = 0; i < d; i++) proj += out[i]!;
		expect(proj).toBeCloseTo(0, 5);
		// Non-PC components survive (compare against plain mean-center).
		const mc = new Float32Array(d);
		applyPreprocess(vec, mc, 'mean-center', t);
		let diffNonConst = 0;
		for (let i = 0; i < d; i++) diffNonConst += Math.abs(out[i]! - mc[i]!);
		expect(diffNonConst).toBeGreaterThan(0);
	});

	it('whiten with identity whitening equals mean-center', () => {
		const out = new Float32Array(d);
		applyPreprocess(vec, out, 'whiten', t);
		const mc = new Float32Array(d);
		applyPreprocess(vec, mc, 'mean-center', t);
		expect(Array.from(out)).toEqual(Array.from(mc));
	});

	it('whiten with a non-identity (diagonal) whitening scales components', () => {
		// Diagonal $W = \mathrm{diag}(2, 1, \ldots, 1)$: the first component doubles.
		const w = identity(d);
		w[0] = 2;
		const diag: TransformBundle = { ...t, whitening: w };
		const out = new Float32Array(d);
		applyPreprocess(vec, out, 'whiten', diag);
		const mc = new Float32Array(d);
		applyPreprocess(vec, mc, 'mean-center', t);
		for (let i = 0; i < d; i++) {
			const expected = i === 0 ? mc[0]! * 2 : mc[i];
			expect(out[i]).toBeCloseTo(expected!, 6);
		}
	});
});
