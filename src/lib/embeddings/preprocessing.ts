import type { PreprocessId, TransformBundle } from './types.js';

/** Scratch buffer for the whitening pass (module-level to avoid
 * per-call allocation; single-threaded use only). */
let scratch = new Float32Array(0);

/**
 * Registry of preprocessing options.
 *
 * Preprocessing is applied to (dequantized) embedding vectors before any
 * distance computation. The transforms themselves are **exported by the
 * Python script** and shipped as part of the bundle — the browser only
 * *applies* them, it never re-derives them.
 */
export const PREPROCESSINGS: Record<
	PreprocessId,
	{ id: PreprocessId; label: string; description: string }
> = {
	none: {
		id: 'none',
		label: 'Raw',
		description: 'Use the dequantized embedding row as-is.',
	},
	'mean-center': {
		id: 'mean-center',
		label: 'Mean-center',
		description: 'Subtract the corpus mean vector.',
	},
	'center-remove-pcs': {
		id: 'center-remove-pcs',
		label: 'De-mean + remove PCs',
		description: 'Mean-center, then remove the top-$n$ principal components.',
	},
	whiten: {
		id: 'whiten',
		label: 'Whiten',
		description: 'Apply the $d \\times d$ whitening matrix (ZCA-style).',
	},
};

/**
 * Apply the selected preprocessing to `vec`, writing into `out`.
 *
 * - `none`: copy.
 * - `mean-center`: subtract the mean.
 * - `center-remove-pcs`: subtract the mean, then remove the top-$n$ PC
 *   projections: $v \leftarrow v - P\,(P^\top v)$ where $P$ is the
 *   $d \times n$ basis (column-major).
 * - `whiten`: apply the $d \times d$ whitening matrix (row-major):
 *   $\mathrm{out}_i = \sum_j W_{ij}\, v_j$.
 *
 * Pure and allocation-free: `out` is fully overwritten; `vec` is
 * unmodified.
 */
export function applyPreprocess(
	vec: Float32Array,
	out: Float32Array,
	id: PreprocessId,
	t: TransformBundle,
): Float32Array {
	const d = Math.min(vec.length, out.length);
	if (id === 'none') {
		for (let i = 0; i < d; i++) out[i] = vec[i]!;
		return out;
	}

	// Mean-center (common to all remaining options).
	const mean = t.mean;
	for (let i = 0; i < d; i++) out[i] = vec[i]! - mean[i]!;
	if (id === 'mean-center') return out;

	if (id === 'center-remove-pcs') {
		const pcs = t.pcs;
		const nPcs = t.eigenvalues.length;
		// Projections $c_k = P_k^\top v$ (columns of the $d \times n$ basis).
		for (let p = 0; p < nPcs; p++) {
			let c = 0;
			for (let i = 0; i < d; i++) c += pcs[i * nPcs + p]! * out[i]!;
			// Subtract $c_k P_k$ in-place (safe: $c_k$ fixed before writes).
			for (let i = 0; i < d; i++) out[i] = out[i]! - c * pcs[i * nPcs + p]!;
		}
		return out;
	}

	// whiten: row-major $d \times d$ matrix-vector product. Needs one
	// scratch vector (in-place is impossible without assuming symmetry);
	// a module-level buffer avoids per-call allocation on hot paths.
	const w = t.whitening;
	if (scratch.length < d) scratch = new Float32Array(d);
	const tmp = scratch;
	for (let i = 0; i < d; i++) {
		let s = 0;
		for (let j = 0; j < d; j++) s += w[i * d + j]! * out[j]!;
		tmp[i] = s;
	}
	for (let i = 0; i < d; i++) out[i] = tmp[i]!;
	return out;
}
