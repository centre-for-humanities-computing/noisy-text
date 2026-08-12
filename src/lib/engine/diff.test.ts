import { describe, it, expect } from 'vitest';
import { countChanged, changedMask } from './diff.js';

describe('countChanged', () => {
	it('returns 0 for identical arrays', () => {
		const a = new Int32Array([0, 1, 2, 3]);
		expect(countChanged(a, a)).toBe(0);
	});

	it('returns length for fully-different arrays', () => {
		const a = new Int32Array([0, 0, 0, 0]);
		const b = new Int32Array([1, 2, 3, 4]);
		expect(countChanged(a, b)).toBe(4);
	});

	it('counts only changed positions', () => {
		const a = new Int32Array([1, 2, 3, 4, 5]);
		const b = new Int32Array([1, 9, 3, 9, 5]);
		expect(countChanged(a, b)).toBe(2);
	});

	it('throws on length mismatch', () => {
		const a = new Int32Array(3);
		const b = new Int32Array(4);
		expect(() => countChanged(a, b)).toThrow('Length mismatch');
	});
});

describe('changedMask', () => {
	it('returns all zeros for identical arrays', () => {
		const a = new Int32Array([1, 2, 3]);
		const mask = changedMask(a, a);
		expect(mask.length).toBe(3);
		expect(mask[0]).toBe(0);
		expect(mask[1]).toBe(0);
		expect(mask[2]).toBe(0);
	});

	it('returns all ones for fully-different arrays', () => {
		const a = new Int32Array([0, 0, 0]);
		const b = new Int32Array([1, 1, 1]);
		const mask = changedMask(a, b);
		expect(mask[0]).toBe(1);
		expect(mask[1]).toBe(1);
		expect(mask[2]).toBe(1);
	});

	it('reuses output buffer when provided', () => {
		const a = new Int32Array([1, 2, 3, 4]);
		const b = new Int32Array([1, 9, 3, 9]);
		const out = new Uint8Array(4);
		out[0] = 255; // pre-fill to verify overwrite

		const mask = changedMask(a, b, out);
		expect(mask).toBe(out);
		expect(mask[0]).toBe(0); // was 255, now overwritten
		expect(mask[1]).toBe(1);
		expect(mask[2]).toBe(0);
		expect(mask[3]).toBe(1);
	});

	it('throws on length mismatch', () => {
		const a = new Int32Array(3);
		const b = new Int32Array(4);
		expect(() => changedMask(a, b)).toThrow('Length mismatch');
	});
});
