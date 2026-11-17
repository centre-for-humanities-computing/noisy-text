import { describe, expect, it } from 'vitest';
import { createRng } from '../engine/rng.js';
import { fixtureBundle, fixtureWords as words, type FixtureEdge } from '../wordnet/test-fixture.js';
import { createWordNetTable, type WordNetResource } from '../wordnet/table.js';
import { createWordNet, createWordNetKernel } from './wordnet.js';
import type { Rng } from './types.js';

/** [target, category] per lemma row. Category order is WORDNET_CATEGORIES. */
const edges: FixtureEdge[][] = [
	[
		[1, 0],
		[2, 0],
		[3, 2],
	],
	[
		[2, 0],
		[0, 1],
	],
	[[1, 1]],
	[[0, 0]],
	[
		[5, 0],
		[6, 0],
	],
	[[4, 1]],
	[[4, 1]],
	[],
];
const bundle = fixtureBundle(edges);
const table = createWordNetTable(bundle, words);
// Ids 0-7 are static; id 8 is an OOV variant that resolves to the `dog` row.
const rows = new Int32Array([0, 1, 2, 3, 4, 5, 6, -1, 0]);
const resource: WordNetResource = { table, rows };

function mockRng(values: number[]): Rng & { calls: () => number } {
	let i = 0;
	const rng = (() => values[i++] ?? 0) as Rng & { calls: () => number };
	rng.calls = () => i;
	return rng;
}

/** Naive cumulative-sum reference built directly from the CSR arrays. */
function naiveSample(token: number, draw: number): number {
	const index = rows[token]!;
	if (index < 0) return token;
	const start = bundle.offsets[index]!;
	const end = bundle.offsets[index + 1]!;
	const perCategory = new Uint32Array(bundle.meta.categoryOrder.length);
	let nonEmpty = 0;
	for (let e = start; e < end; e++) {
		const category = bundle.categories[e]!;
		if (perCategory[category] === 0) nonEmpty++;
		perCategory[category]!++;
	}
	if (nonEmpty === 0) return token;

	let cumulative = 0;
	for (let e = start; e < end; e++) {
		const category = bundle.categories[e]!;
		cumulative += 1 / (nonEmpty * perCategory[category]!);
		if (draw < cumulative) return bundle.targets[e]!;
	}
	return bundle.targets[end - 1]!;
}

describe('createWordNetKernel', () => {
	it('gives every non-empty category equal mass and spreads it uniformly', () => {
		const row = createWordNetKernel(resource).getRow(0);
		expect(Array.from(row.ids)).toEqual([1, 2, 3]);
		expect(Array.from(row.probs)).toEqual([0.25, 0.25, 0.5]);
	});

	it('reads OOV ids through the shared row index', () => {
		const kernel = createWordNetKernel(resource);
		expect(Array.from(kernel.getRow(8).ids)).toEqual(Array.from(kernel.getRow(0).ids));
	});

	it('stays on an empty row and still consumes its draw', () => {
		const rng = mockRng([0.9]);
		expect(createWordNetKernel(resource).sampleStep(7, rng)).toBe(7);
		expect(rng.calls()).toBe(1);
	});

	it('never targets itself or an id outside the static vocabulary', () => {
		const kernel = createWordNetKernel(resource);
		for (let token = 0; token < words.length; token++) {
			const row = kernel.getRow(token);
			for (const id of row.ids) {
				expect(id).toBeGreaterThanOrEqual(0);
				expect(id).toBeLessThan(words.length);
				expect(bundle.rowMap[id]).not.toBe(rows[token]);
			}
		}
	});

	it('matches a naive cumulative-sum reference (seeded differential)', () => {
		const kernel = createWordNetKernel(resource);
		for (let seed = 1; seed <= 5; seed++) {
			const actual = createRng(seed);
			const reference = createRng(seed);
			const pick = createRng(seed * 101);
			for (let n = 0; n < 200; n++) {
				const token = Math.floor(pick() * words.length);
				expect(kernel.sampleStep(token, actual)).toBe(naiveSample(token, reference()));
			}
		}
	});
});

describe('createWordNet strategy', () => {
	const strategy = createWordNet({}, words.length, { wordnet: resource });

	it('draws exactly two values per step, including on an uncovered token', () => {
		const jump = mockRng([0, 0.1]);
		expect(strategy.sampleStep(0, 1, jump)).toBe(1);
		expect(jump.calls()).toBe(2);

		const stay = mockRng([0.9, 0.1]);
		expect(strategy.sampleStep(0, 0, stay)).toBe(0);
		expect(stay.calls()).toBe(2);

		const uncovered = mockRng([0, 0.1]);
		expect(strategy.sampleStep(7, 1, uncovered)).toBe(7);
		expect(uncovered.calls()).toBe(2);
	});

	it('stays put when no WordNet resource is available', () => {
		const rng = mockRng([0, 0.1]);
		expect(createWordNet({}, words.length).sampleStep(0, 1, rng)).toBe(0);
		expect(rng.calls()).toBe(2);
	});
});
