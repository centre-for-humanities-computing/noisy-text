import { describe, it, expect } from 'vitest';
import { countChanged, changedMask, recencyAt, tokenCharRanges } from './diff.js';
import type { Trajectory } from './types.js';

/** Build a minimal Trajectory from a 2D array of rows for testing. */
function makeTraj(rows: number[][]): Trajectory {
	const T = rows.length - 1;
	const L = rows[0]!.length;
	const flat = new Int32Array((T + 1) * L);
	for (let t = 0; t <= T; t++) {
		flat.set(rows[t]!, t * L);
	}
	return {
		rows: flat,
		T,
		length: L,
		seed: 0,
		tokensAt(t: number): Int32Array {
			return flat.subarray(t * L, (t + 1) * L);
		},
	};
}

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

describe('recencyAt', () => {
	it('returns all zeros at t=0', () => {
		// x_0 = [1,2,3], x_1 = [9,9,9] — but t=0 so no lookback.
		const traj = makeTraj([
			[1, 2, 3],
			[9, 9, 9],
		]);
		const r = recencyAt(traj, 0, 4);
		expect(r[0]).toBe(0);
		expect(r[1]).toBe(0);
		expect(r[2]).toBe(0);
	});

	it('returns 1 for positions that changed at current step', () => {
		// x_0 = [1,2,3], x_1 = [9,2,3] — only position 0 changed.
		const traj = makeTraj([
			[1, 2, 3],
			[9, 2, 3],
		]);
		const r = recencyAt(traj, 1, 4);
		expect(r[0]).toBeCloseTo(1);
		expect(r[1]).toBe(0);
		expect(r[2]).toBe(0);
	});

	it('fades recency over multiple steps', () => {
		// x_0 = [1,2], x_1 = [9,2] (pos 0 changed at t=1),
		// x_2 = [9,8] (pos 1 changed at t=2).
		const traj = makeTraj([
			[1, 2],
			[9, 2],
			[9, 8],
		]);
		const r = recencyAt(traj, 2, 4);
		// pos 0 changed 1 step ago → 1 - 1/4 = 0.75
		expect(r[0]).toBeCloseTo(0.75);
		// pos 1 changed at current step → 1
		expect(r[1]).toBeCloseTo(1);
	});

	it('returns 0 for positions unchanged within window', () => {
		// x_0 = [1,2], x_1 = [9,2], x_2 = [9,2], x_3 = [9,2].
		// pos 0 changed at t=1, window=2, t=3 → stepsAgo=2, 1-2/2=0.
		const traj = makeTraj([
			[1, 2],
			[9, 2],
			[9, 2],
			[9, 2],
		]);
		const r = recencyAt(traj, 3, 2);
		expect(r[0]).toBe(0);
		expect(r[1]).toBe(0);
	});

	it('reuses output buffer when provided', () => {
		const traj = makeTraj([
			[1, 2],
			[9, 2],
		]);
		const out = new Float32Array(2);
		out[0] = 99; // pre-fill to verify overwrite
		const r = recencyAt(traj, 1, 4, out);
		expect(r).toBe(out);
		expect(r[0]).toBeCloseTo(1);
		expect(r[1]).toBe(0);
	});

	it('handles window=1 (only current step matters)', () => {
		const traj = makeTraj([
			[1, 2],
			[9, 2],
			[9, 8],
		]);
		const r = recencyAt(traj, 2, 1);
		// pos 0 changed at t=1, window=1, t=2 → stepsAgo=1, 1-1/1=0.
		expect(r[0]).toBe(0);
		// pos 1 changed at t=2 → 1.
		expect(r[1]).toBeCloseTo(1);
	});
});

describe('tokenCharRanges', () => {
	/** Stub decoder: each token id maps to a fixed-length string. */
	function decode(id: number): string {
		// id 0 = empty (e.g. padding), id 99 = mask sentinel
		if (id === 0) return '';
		if (id === 99) return '[MASK]';
		return `t${id}`;
	}

	it('returns empty when no tokens have recency > 0', () => {
		const ids = new Int32Array([1, 2, 3]);
		const recency = new Float32Array([0, 0, 0]);
		expect(tokenCharRanges(ids, recency, decode, 99)).toEqual([]);
	});

	it('returns empty for empty input', () => {
		const ids = new Int32Array(0);
		const recency = new Float32Array(0);
		expect(tokenCharRanges(ids, recency, decode, 99)).toEqual([]);
	});

	it('maps single changed token to its character span', () => {
		// ids [1, 2, 3] → "t1t2t3" (each 2 chars)
		const ids = new Int32Array([1, 2, 3]);
		const recency = new Float32Array([0, 1, 0]);
		const ranges = tokenCharRanges(ids, recency, decode, 99);
		expect(ranges).toHaveLength(1);
		expect(ranges[0]!.start).toBe(2); // after "t1"
		expect(ranges[0]!.end).toBe(4); // "t2"
		expect(ranges[0]!.recency).toBe(1);
	});

	it('merges adjacent tokens with same recency', () => {
		const ids = new Int32Array([1, 2, 3, 4]);
		const recency = new Float32Array([0, 1, 1, 0]);
		const ranges = tokenCharRanges(ids, recency, decode, 99);
		expect(ranges).toHaveLength(1);
		expect(ranges[0]!.start).toBe(2); // after "t1"
		expect(ranges[0]!.end).toBe(6); // "t2t3"
		expect(ranges[0]!.recency).toBe(1);
	});

	it('keeps separate ranges for different recency values', () => {
		const ids = new Int32Array([1, 2, 3]);
		const recency = new Float32Array([0.5, 1, 0]);
		const ranges = tokenCharRanges(ids, recency, decode, 99);
		expect(ranges).toHaveLength(2);
		expect(ranges[0]!.start).toBe(0);
		expect(ranges[0]!.end).toBe(2);
		expect(ranges[0]!.recency).toBe(0.5);
		expect(ranges[1]!.start).toBe(2);
		expect(ranges[1]!.end).toBe(4);
		expect(ranges[1]!.recency).toBe(1);
	});

	it('skips mask sentinel tokens', () => {
		const ids = new Int32Array([1, 99, 2]);
		const recency = new Float32Array([0, 1, 1]);
		const ranges = tokenCharRanges(ids, recency, decode, 99);
		// Token 1 (recency 0) → "t1" at [0,2), skipped.
		// Token 99 (mask) → skipped entirely.
		// Token 2 (recency 1) → "t2" at [2,4).
		expect(ranges).toHaveLength(1);
		expect(ranges[0]!.start).toBe(2);
		expect(ranges[0]!.end).toBe(4);
		expect(ranges[0]!.recency).toBe(1);
	});

	it('skips tokens that decode to empty string', () => {
		const ids = new Int32Array([0, 1, 0]);
		const recency = new Float32Array([1, 1, 1]);
		const ranges = tokenCharRanges(ids, recency, decode, 99);
		// id 0 → "", id 1 → "t1", id 0 → ""
		expect(ranges).toHaveLength(1);
		expect(ranges[0]!.start).toBe(0);
		expect(ranges[0]!.end).toBe(2);
		expect(ranges[0]!.recency).toBe(1);
	});

	it('handles all tokens changed', () => {
		const ids = new Int32Array([1, 2]);
		const recency = new Float32Array([1, 1]);
		const ranges = tokenCharRanges(ids, recency, decode, 99);
		expect(ranges).toHaveLength(1);
		expect(ranges[0]!.start).toBe(0);
		expect(ranges[0]!.end).toBe(4);
		expect(ranges[0]!.recency).toBe(1);
	});
});
