/**
 * String-distance kernels: "a string function applied to each token,
 * then a string distance" as one composable unit.
 *
 * Each `StringDistanceKernel` is a genuine, testable string-level
 * composition: `stringFn` canonicalizes a raw token string and
 * `distanceFn` measures the distance between two canonical strings.
 * The optimized candidate indexing (bigram/char inverted indexes) stays
 * in the `DistanceModel` implementations — `makeModel` builds them — so
 * this module carries no hot-path cost. It is also the seam for future
 * kernels (e.g. phonetic) that follow the same shape.
 *
 * Consistency contract: for the same vocab, the model built by
 * `makeModel` and the `stringFn`/`distanceFn` pair must agree —
 * $d_{\text{model}}(a, b) = \text{distanceFn}(\text{stringFn}(a), \text{stringFn}(b))$
 * whenever the model distance is within its radius ceiling.
 */

import type { DistanceModel } from './distance-model.js';
import { EditDistanceModel, levenshtein } from './distance-model.js';
import { CharOverlapModel } from './char-overlap-model.js';
import type { CharOverlapMode } from './char-overlap-model.js';

export type StringFn = (raw: string) => string;
export type DistanceFn = (a: string, b: string) => number;

export interface StringDistanceKernel {
	/** Stable id, e.g. `'edit-distance'` or `'char-overlap-set'`. */
	readonly id: string;
	readonly stringFn: StringFn;
	readonly distanceFn: DistanceFn;
	/** Build the optimized `DistanceModel` over the decoded vocab strings. */
	makeModel(strings: readonly string[]): DistanceModel;
}

/**
 * Set Jaccard distance over the character sets of two canonical strings
 * (canonical set strings hold distinct chars, so `Set` recovers them).
 * Empty either side → distance 1 (no overlap), matching the model.
 */
function jaccardSet(a: string, b: string): number {
	const setA = new Set(a);
	const setB = new Set(b);
	if (setA.size === 0 || setB.size === 0) return 1;
	let intersection = 0;
	const [small, large] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
	for (const ch of small) {
		if (large.has(ch)) intersection++;
	}
	return 1 - intersection / (setA.size + setB.size - intersection);
}

/**
 * Multiset Jaccard distance over the character counts of two canonical
 * strings (sorted multiset strings preserve counts).
 */
function jaccardMultiset(a: string, b: string): number {
	const countsOf = (s: string): Map<string, number> => {
		const counts = new Map<string, number>();
		for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
		return counts;
	};
	const countsA = countsOf(a);
	const countsB = countsOf(b);
	if (countsA.size === 0 || countsB.size === 0) return 1;
	const [small, large] = countsA.size <= countsB.size ? [countsA, countsB] : [countsB, countsA];
	let sumMin = 0;
	let sumMax = 0;
	const seen = new Set<string>();
	for (const [ch, countSmall] of small) {
		const countLarge = large.get(ch) ?? 0;
		sumMin += Math.min(countSmall, countLarge);
		sumMax += Math.max(countSmall, countLarge);
		seen.add(ch);
	}
	for (const [ch, countLarge] of large) {
		if (seen.has(ch)) continue;
		sumMax += countLarge;
	}
	return 1 - sumMin / sumMax;
}

export const STRING_DISTANCE_KERNELS: Record<string, StringDistanceKernel> = {
	'edit-distance': {
		id: 'edit-distance',
		stringFn: (s) => s,
		// Unbounded Levenshtein: early exit at the longer length, i.e. none.
		distanceFn: (a, b) => levenshtein(a, b, Math.max(a.length, b.length)),
		makeModel: (strings) => new EditDistanceModel(strings),
	},
	'char-overlap-set': {
		id: 'char-overlap-set',
		// Canonical form: sorted distinct code points.
		stringFn: (s) => [...new Set(s)].sort().join(''),
		distanceFn: jaccardSet,
		makeModel: (strings) => new CharOverlapModel(strings, 'set'),
	},
	'char-overlap-multiset': {
		id: 'char-overlap-multiset',
		// Canonical form: sorted multiset of code points (counts preserved).
		stringFn: (s) => [...s].sort().join(''),
		distanceFn: jaccardMultiset,
		makeModel: (strings) => new CharOverlapModel(strings, 'multiset'),
	},
};

/**
 * Look up a string-distance kernel by id.
 *
 * @param id - One of the `STRING_DISTANCE_KERNELS` keys.
 * @returns The matching kernel.
 * @throws If the id is not a known kernel.
 */
export function getStringDistanceKernel(id: string): StringDistanceKernel {
	if (!Object.hasOwn(STRING_DISTANCE_KERNELS, id)) {
		throw new Error(
			`Unknown string distance kernel "${id}". Known: ${Object.keys(STRING_DISTANCE_KERNELS).join(', ')}`,
		);
	}
	return STRING_DISTANCE_KERNELS[id]!;
}

/**
 * Select the char-overlap kernel for a `CharOverlapMode` (the mode the
 * char-overlap strategy exposes in its config/UI).
 */
export function stringDistanceKernelFor(mode?: CharOverlapMode): StringDistanceKernel {
	return mode === 'multiset'
		? STRING_DISTANCE_KERNELS['char-overlap-multiset']!
		: STRING_DISTANCE_KERNELS['char-overlap-set']!;
}
