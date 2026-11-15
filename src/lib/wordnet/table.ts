import type { WordNetBundle, WordNetCategory } from './loader.js';

/** One outbound edge from a lemma row. */
export interface WordNetRelation {
	target: number;
	category: WordNetCategory;
}

/** Read-only view over one decoded bundle, indexed by static token id or word. */
export interface WordNetTable {
	readonly bundle: WordNetBundle;
	/** Dense row index for an id or word, `undefined` when the token has no row. */
	row(token: number | string): number | undefined;
	hasRow(token: number | string): boolean;
	/** Outbound edges in bundle order; empty when the token has no row. */
	lookup(token: number | string): WordNetRelation[];
	/**
	 * Fraction of letter-bearing token positions covered by the bundle.
	 *
	 * `ids[i]` is tried first, then `strings[i]` case-insensitively (so an
	 * OOV `Dogs` still reaches the `dog` row). Spaces, punctuation and other
	 * non-letters are excluded from the denominator; letter tokens with no
	 * row count as uncovered.
	 */
	coverage(ids: Int32Array, strings: readonly string[]): number;
}

const LETTER = /\p{L}/u;

export function createWordNetTable(bundle: WordNetBundle, words: readonly string[]): WordNetTable {
	const byWord = new Map<string, number>();
	for (let i = 0; i < words.length; i++) byWord.set(words[i]!.toLowerCase(), i);

	function row(token: number | string): number | undefined {
		const id = typeof token === 'number' ? token : byWord.get(token.toLowerCase());
		if (id === undefined) return undefined;
		const index = bundle.rowMap[id];
		return index !== undefined && index >= 0 && index < bundle.meta.rows ? index : undefined;
	}

	function lookup(token: number | string): WordNetRelation[] {
		const index = row(token);
		if (index === undefined) return [];
		const out: WordNetRelation[] = [];
		for (let e = bundle.offsets[index]!; e < bundle.offsets[index + 1]!; e++) {
			out.push({
				target: bundle.targets[e]!,
				category: bundle.meta.categoryOrder[bundle.categories[e]!]!,
			});
		}
		return out;
	}

	function coverage(ids: Int32Array, strings: readonly string[]): number {
		let total = 0;
		let covered = 0;
		for (let i = 0; i < ids.length; i++) {
			const token = strings[i];
			if (token === undefined || !LETTER.test(token)) continue;
			total++;
			if (row(ids[i]!) !== undefined || row(token) !== undefined) covered++;
		}
		return total === 0 ? 0 : covered / total;
	}

	return { bundle, row, hasRow: (token) => row(token) !== undefined, lookup, coverage };
}
