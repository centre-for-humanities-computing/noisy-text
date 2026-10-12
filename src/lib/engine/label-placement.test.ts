import { describe, it, expect } from 'vitest';
import { placeLabels, type LabelPlacementOptions } from './label-placement.js';

const OPTS: LabelPlacementOptions = {
	width: 300,
	height: 200,
	labelHeight: 10,
	maxLabels: 1000,
	gap: 4,
	cell: 48,
};

describe('placeLabels', () => {
	it('accepts labels that do not overlap, in priority order', () => {
		expect(placeLabels(3, [50, 150, 250], [50, 100, 150], [30, 30, 30], OPTS)).toEqual([0, 1, 2]);
	});

	it('drops a lower-priority label that overlaps an earlier one', () => {
		expect(placeLabels(2, [100, 102], [100, 100], [40, 40], OPTS)).toEqual([0]);
	});

	it('keeps the gap between boxes', () => {
		// Width 40: the first box spans x 80..120. A centre at 144 starts at
		// 124, a gap of exactly 4 px, which is allowed.
		expect(placeLabels(2, [100, 144], [100, 100], [40, 40], OPTS)).toEqual([0, 1]);
		// A centre at 143 leaves a gap of 3 px, which is not.
		expect(placeLabels(2, [100, 143], [100, 100], [40, 40], OPTS)).toEqual([0]);
	});

	it('clears a pair when either axis separates the boxes', () => {
		// Same x. Label height 10 plus gap 4 needs 14 px between centres vertically.
		expect(placeLabels(2, [100, 100], [100, 114], [40, 40], OPTS)).toEqual([0, 1]);
		expect(placeLabels(2, [100, 100], [100, 113], [40, 40], OPTS)).toEqual([0]);
	});

	it('skips anchors outside the canvas', () => {
		expect(placeLabels(3, [-1, 150, 301], [50, 50, 50], [20, 20, 20], OPTS)).toEqual([1]);
	});

	it('stops after maxLabels acceptances', () => {
		const xs = [20, 60, 100, 140, 180];
		const ys = [20, 20, 20, 20, 20];
		const ws = [20, 20, 20, 20, 20];
		expect(placeLabels(5, xs, ys, ws, { ...OPTS, maxLabels: 3 })).toEqual([0, 1, 2]);
	});

	it('matches a brute-force greedy placement on dense random input', () => {
		let seed = 12345;
		const rand = (): number => {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			return seed / 0x7fffffff;
		};
		const n = 400;
		const x = new Float32Array(n);
		const y = new Float32Array(n);
		const w = new Float32Array(n);
		for (let k = 0; k < n; k++) {
			x[k] = rand() * 340 - 20; // some anchors fall off the canvas
			y[k] = rand() * 240 - 20;
			w[k] = 15 + rand() * 40;
		}

		const halfH = OPTS.labelHeight / 2;
		const boxOf = (k: number) => ({
			l: x[k]! - w[k]! / 2,
			r: x[k]! + w[k]! / 2,
			t: y[k]! - halfH,
			b: y[k]! + halfH,
		});
		const conflict = (a: ReturnType<typeof boxOf>, o: ReturnType<typeof boxOf>): boolean =>
			a.l < o.r + OPTS.gap && o.l < a.r + OPTS.gap && a.t < o.b + OPTS.gap && o.t < a.b + OPTS.gap;

		// Reference: test each candidate against every box accepted so far.
		const ref: number[] = [];
		for (let k = 0; k < n; k++) {
			if (x[k]! < 0 || x[k]! > OPTS.width || y[k]! < 0 || y[k]! > OPTS.height) continue;
			const a = boxOf(k);
			if (!ref.some((j) => conflict(a, boxOf(j)))) ref.push(k);
		}

		const got = placeLabels(n, x, y, w, OPTS);
		expect(got).toEqual(ref);
		expect(got.length).toBeGreaterThan(10);

		// The accepted boxes really keep the gap from each other.
		for (let i = 0; i < got.length; i++) {
			for (let j = i + 1; j < got.length; j++) {
				expect(conflict(boxOf(got[i]!), boxOf(got[j]!))).toBe(false);
			}
		}
	});
});
