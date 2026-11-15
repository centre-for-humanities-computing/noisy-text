import { describe, expect, it } from 'vitest';
import { WORDNET_CATEGORIES, type WordNetBundle } from './loader.js';
import { createWordNetTable } from './table.js';

const words = ['dog', 'canine', 'animal', 'puppy', 'bank', 'shore', 'money', 'zzz'];
const edges: [number, number][][] = [
	[
		[1, 0],
		[2, 0],
		[2, 2],
		[3, 1],
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
const offsets = new Int32Array(edges.length + 1);
const targets: number[] = [];
const categories: number[] = [];
edges.forEach((row, i) => {
	offsets[i] = targets.length;
	for (const [target, category] of row) {
		targets.push(target);
		categories.push(category);
	}
});
offsets[edges.length] = targets.length;
const bundle: WordNetBundle = {
	meta: {
		source: 'oewn-2025',
		license: 'CC BY 4.0',
		attribution: 'test fixture',
		vocabSha: '',
		vocabSize: words.length,
		rows: edges.length,
		edgeCount: targets.length,
		coveredLemmas: 7,
		categoryOrder: [...WORDNET_CATEGORIES],
	},
	rowMap: new Int32Array([0, 1, 2, 3, 4, 5, 6, -1]),
	offsets,
	targets: new Int32Array(targets),
	categories: new Uint8Array(categories),
};
const table = createWordNetTable(bundle, words);

describe('wordnet table', () => {
	it('looks up by id or word, resolving case', () => {
		expect(table.row('DOG')).toBe(0);
		expect(table.lookup('DoG')).toEqual(table.lookup(0));
		expect(table.lookup('dog').map((r) => r.target)).toEqual([1, 2, 2, 3]);
	});

	it('unions senses and keeps a target under both categories', () => {
		expect(table.lookup('bank').map((r) => r.target)).toEqual([5, 6]);
		const animal = table.lookup('dog').filter((r) => r.target === 2);
		expect(animal.map((r) => r.category)).toEqual(['hypernym', 'synonym']);
	});

	it('reports tokens without a row', () => {
		expect(table.hasRow('zzz')).toBe(false);
		expect(table.row(7)).toBeUndefined();
		expect(table.lookup('missing')).toEqual([]);
	});

	it('counts only letter positions, leaving OOV uncovered', () => {
		const ids = new Int32Array([0, 1, 2, 7, 8]);
		expect(table.coverage(ids, ['dog', 'canine', 'animal', 'zzz', '!'])).toBe(0.75);
		expect(table.coverage(new Int32Array([8]), ['DoG'])).toBe(1);
		expect(table.coverage(new Int32Array([8, 8]), [' ', ','])).toBe(0);
	});
});
