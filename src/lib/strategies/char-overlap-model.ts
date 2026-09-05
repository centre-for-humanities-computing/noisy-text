/**
 * Character-overlap `DistanceModel` backed by a character inverted index.
 *
 * Distance between two tokens is the Jaccard distance over their character
 * sets (code points of the raw subword string):
 *
 * $$d(a, b) = 1 - \frac{|C(a) \cap C(b)|}{|C(a) \cup C(b)|}$$
 *
 * where $C(t)$ is the set of code points in token $t$'s string.
 * Self-distance is $0$; disjoint or empty sets yield $d = 1$.
 *
 * ## Candidate pruning (sound to radius $r$)
 *
 * Any token with $d(a,b) \le r$ must share at least one character with
 * $a$ (unless $r = 1$, which includes everything). A character inverted
 * index (char → token ids) provides a sound superset: candidates are
 * the union of index lists for $a$'s characters. Tokens with an empty
 * character set have no candidates (they are distance 1 from everything).
 *
 * ## Construction cost
 * $O(K \cdot \bar{c})$ to build the character inverted index, where
 * $\bar{c}$ is the average number of distinct characters per token.
 * Per-`candidates` cost is proportional to the number of index hits.
 */

import type { DistanceModel } from './distance-model.js';

/**
 * Yield distinct code points of $s$ as strings.
 * Each code point is represented as a single-character string.
 */
function* codePoints(s: string): Generator<string> {
	for (const cp of s) {
		yield cp;
	}
}

export class CharOverlapModel implements DistanceModel {
	readonly id = 'char-overlap';
	readonly K: number;

	private _charSets: Set<string>[];

	// Built lazily on first candidates() call.
	private _index: Map<string, number[]> | null = null;

	constructor(strings: readonly string[]) {
		this.K = strings.length;

		// Precompute per-token character sets: O(K), cheap.
		this._charSets = new Array(this.K);
		for (let i = 0; i < this.K; i++) {
			this._charSets[i] = new Set(codePoints(strings[i]!));
		}
	}

	/** Build the character inverted index (lazy, called once). */
	private _ensureIndex(): Map<string, number[]> {
		if (this._index) return this._index;

		const index = new Map<string, number[]>();
		for (let i = 0; i < this.K; i++) {
			for (const ch of this._charSets[i]!) {
				let list = index.get(ch);
				if (!list) {
					list = [];
					index.set(ch, list);
				}
				list.push(i);
			}
		}
		this._index = index;
		return index;
	}

	/**
	 * Yield candidate token ids that could be within `radius` of `token`.
	 *
	 * Uses the character inverted index: any token with $d \le r < 1$
	 * must share at least one character. Tokens with an empty character
	 * set yield no candidates (they are distance 1 from everything).
	 */
	*candidates(token: number, radius: number): Iterable<number> {
		const charSet = this._charSets[token]!;
		if (charSet.size === 0) return;

		// If radius >= 1, every token is a candidate.
		if (radius >= 1) {
			for (let j = 0; j < this.K; j++) {
				if (j !== token) yield j;
			}
			return;
		}

		const index = this._ensureIndex();
		const seen = new Set<number>();

		for (const ch of charSet) {
			const candList = index.get(ch);
			if (!candList) continue;
			for (const j of candList) {
				if (j === token) continue;
				if (seen.has(j)) continue;
				seen.add(j);
				yield j;
			}
		}
	}

	/**
	 * Exact Jaccard distance between two token ids, with early exit at
	 * `maxDist`.
	 *
	 * Returns $d(a,b) = 1 - |C(a) \cap C(b)| / |C(a) \cup C(b)|$ if
	 * $\le$ `maxDist`, or `maxDist + 1` otherwise.
	 *
	 * Symmetric: $d(a,b) = d(b,a)$. Self-distance is $0$.
	 */
	distance(a: number, b: number, maxDist: number): number {
		if (a === b) return 0;

		const setA = this._charSets[a]!;
		const setB = this._charSets[b]!;

		// Both empty → distance 1 (no overlap).
		if (setA.size === 0 && setB.size === 0) return 1 <= maxDist ? 1 : maxDist + 1;

		// One empty → distance 1.
		if (setA.size === 0 || setB.size === 0) return 1 <= maxDist ? 1 : maxDist + 1;

		// Compute intersection size. Iterate over the smaller set.
		const [small, large] = setA.size <= setB.size ? [setA, setB] : [setB, setA];
		let intersection = 0;
		for (const ch of small) {
			if (large.has(ch)) intersection++;
		}

		const union = setA.size + setB.size - intersection;
		const d = 1 - intersection / union;

		return d <= maxDist ? d : maxDist + 1;
	}
}
