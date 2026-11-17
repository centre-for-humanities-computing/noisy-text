import { describe, expect, it } from 'vitest';
import { createWordNetTable } from './table.js';
import { fixtureBundle, fixtureWords as words, type FixtureEdge } from './test-fixture.js';

/** Dog has edges from both its noun (0) and verb (1) synsets. */
const edges: FixtureEdge[][] = [
	[
		[1, 0, 0, 2],
		[2, 0, 0, 3],
		[2, 2, 0, 0],
		[3, 1, 1, 4],
	],
	[
		[2, 0, 2, 3],
		[0, 1, 2, 0],
	],
	[[1, 1, 3, 2]],
	[[0, 0, 4, 0]],
	[
		[5, 0, 5, 6],
		[6, 0, 5, 7],
	],
	[[4, 1, 6, 5]],
	[[4, 1, 7, 5]],
	[],
];
const bundle = fixtureBundle(edges);
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

	it('reports the synset each edge was exported from', () => {
		const dog = table.lookup('dog');
		expect(dog.map((r) => r.edge)).toEqual([0, 1, 2, 3]);
		expect(dog.map((r) => r.sourceSynset)).toEqual([0, 0, 0, 1]);
		expect(dog.map((r) => r.targetSynset)).toEqual([2, 3, 0, 4]);
		expect(new Set(dog.map((r) => r.sourceSynset)).size).toBe(2);
	});

	it('decodes a synset entry lazily and rejects a bad index', () => {
		expect(table.synset(0)).toEqual({ id: 'oewn-00000001-n', label: 'dog (n.)' });
		expect(table.synset(1)).toEqual({ id: 'oewn-00000002-v', label: 'dog (v.)' });
		expect(table.synset(99)).toBeUndefined();
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
