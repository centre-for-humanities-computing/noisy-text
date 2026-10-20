import type { QuantizedMatrix } from './types.js';

/**
 * Dequantize one row of the per-row-symmetric int8 matrix into `out`:
 *
 * $$\hat W_{ij} = \mathrm{code}_{ij} \cdot \mathrm{scale}_i$$
 *
 * `out` must have length $\ge$ `dim` (typically exactly `dim`); it is
 * fully overwritten up to `dim`. Allocation-free into `out`.
 *
 * @param matrix - The quantized matrix.
 * @param row - Row index in $[0, K)$.
 * @param out - Output buffer (length $\ge$ `dim`).
 * @returns The same `out` array (for chaining).
 */
export function dequantizeRow(
	matrix: QuantizedMatrix,
	row: number,
	out: Float32Array,
): Float32Array {
	const { codes, scales, dim } = matrix;
	const offset = row * dim;
	const scale = scales[row]!;
	for (let j = 0; j < dim; j++) {
		out[j] = codes[offset + j]! * scale;
	}
	return out;
}
