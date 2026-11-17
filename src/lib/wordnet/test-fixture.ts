import { WORDNET_CATEGORIES, type WordNetBundle } from './loader.js';

/** Static vocabulary shared by the WordNet table and strategy tests. */
export const fixtureWords = ['dog', 'canine', 'animal', 'puppy', 'bank', 'shore', 'money', 'zzz'];

/** `[target id, category index, source synset, target synset]`; synsets default to 0. */
export type FixtureEdge = [number, number, number?, number?];

/** Synset blob entries, `<id>\t<label>` each, shared by both fixtures. */
export const fixtureSynsets = [
	'oewn-00000001-n\tdog (n.)',
	'oewn-00000002-v\tdog (v.)',
	'oewn-00000003-n\tcanine (n.)',
	'oewn-00000004-n\tanimal (n.)',
	'oewn-00000005-n\tpuppy (n.)',
	'oewn-00000006-n\tbank (n.)',
	'oewn-00000007-n\tshore (n.)',
	'oewn-00000008-n\tmoney (n.)',
];

/** Build a bundle whose row index equals its token id; an empty row has no row. */
export function fixtureBundle(
	rows: readonly (readonly FixtureEdge[])[],
	synsets: readonly string[] = fixtureSynsets,
): WordNetBundle {
	const rowMap = new Int32Array(fixtureWords.length).fill(-1);
	const offsets = new Int32Array(rows.length + 1);
	const targets: number[] = [];
	const categories: number[] = [];
	const sourceSynset: number[] = [];
	const targetSynset: number[] = [];
	rows.forEach((row, index) => {
		offsets[index] = targets.length;
		if (row.length > 0) rowMap[index] = index;
		for (const [target, category, source = 0, targetSynsetIndex = 0] of row) {
			targets.push(target);
			categories.push(category);
			sourceSynset.push(source);
			targetSynset.push(targetSynsetIndex);
		}
	});
	offsets[rows.length] = targets.length;

	const encoder = new TextEncoder();
	const entries = synsets.map((entry) => encoder.encode(entry));
	const synsetBlob = new Uint8Array(entries.reduce((total, entry) => total + entry.length, 0));
	const synsetOffsets = new Int32Array(entries.length + 1);
	let at = 0;
	for (const [index, entry] of entries.entries()) {
		synsetBlob.set(entry, at);
		at += entry.length;
		synsetOffsets[index + 1] = at;
	}

	return {
		meta: {
			source: 'oewn-2025',
			license: 'CC BY 4.0',
			attribution: 'test fixture',
			vocabSha: '',
			vocabSize: fixtureWords.length,
			rows: rows.length,
			edgeCount: targets.length,
			synsetCount: synsets.length,
			coveredLemmas: 7,
			categoryOrder: [...WORDNET_CATEGORIES],
		},
		rowMap,
		offsets,
		targets: new Int32Array(targets),
		sourceSynset: new Int32Array(sourceSynset),
		targetSynset: new Int32Array(targetSynset),
		synsetOffsets,
		synsetBlob,
		categories: new Uint8Array(categories),
	};
}
