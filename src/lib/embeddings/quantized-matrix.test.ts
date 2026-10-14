import { describe, expect, it } from 'vitest';
import { dequantizeRow } from './quantized-matrix.js';
import type { QuantizedMatrix } from './types.js';

function makeMatrix(rows: number, dim: number, values: number[][]): QuantizedMatrix {
	const codes = new Int8Array(rows * dim);
	const scales = new Float32Array(rows);
	for (let i = 0; i < rows; i++) {
		let maxAbs = 0;
		for (let j = 0; j < dim; j++) maxAbs = Math.max(maxAbs, Math.abs(values[i]![j]!));
		scales[i] = maxAbs / 127;
		for (let j = 0; j < dim; j++) {
			codes[i * dim + j] = Math.round(values[i]![j]! / scales[i]!);
		}
	}
	return { codes, scales, vocabSize: rows, dim };
}

describe('dequantizeRow', () => {
	it('round-trips within per-row scale tolerance', () => {
		const dim = 16;
		const values: number[][] = [];
		for (let i = 0; i < 8; i++) {
			const row: number[] = [];
			for (let j = 0; j < dim; j++) row.push((Math.sin(i * 7 + j * 3) * 2.5) | 0 || 0.3);
			values.push(row);
		}
		const m = makeMatrix(8, dim, values);
		const out = new Float32Array(dim);
		for (let i = 0; i < 8; i++) {
			dequantizeRow(m, i, out);
			for (let j = 0; j < dim; j++) {
				const err = Math.abs(out[j]! - values[i]![j]!);
				expect(err).toBeLessThanOrEqual(m.scales[i]! / 2 + 1e-9);
			}
		}
	});

	it('maps the full int8 range and a zero row exactly', () => {
		const m = makeMatrix(2, 4, [
			[127, -127, 0, 64],
			[0, 0, 0, 0],
		]);
		const out = new Float32Array(4);
		dequantizeRow(m, 0, out);
		expect(out[0]).toBeCloseTo(127 * m.scales[0]!, 5);
		expect(out[1]).toBeCloseTo(-127 * m.scales[0]!, 5);
		expect(out[2]).toBe(0);
		dequantizeRow(m, 1, out);
		expect(Array.from(out).every((v) => v === 0)).toBe(true);
	});
});
