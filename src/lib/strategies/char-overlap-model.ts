/**
 * Character-overlap `DistanceModel` backed by a character inverted index.
 *
 * Supports two modes:
 *
 * - **set** (default): Jaccard distance over distinct character sets.
 *   $d(a,b) = 1 - |C(a) \cap C(b)| / |C(a) \cup C(b)|$.
 *   Repeated characters are ignored; `dog`, `doggo`, `good` and `god` have $d = 0$.
 *
 * - **multiset**: Multiset Jaccard distance over character counts.
 *   $d(a,b) = 1 - \frac{\sum_c \min(n_a(c), n_b(c))}{\sum_c \max(n_a(c), n_b(c))}$
 *   where $n_t(c)$ is the count of character $c$ in token $t$.
 *   Repeated characters matter: `dog` and `god` still have $d = 0$,
 *   but `dog` and `doggo` have $d = 1 - 3/5 = 0.4$.
 *
 * Self-distance is $0$; disjoint or empty strings yield $d = 1$.
 *
 * ## Candidate pruning (sound to radius $r$)
 *
 * Any token with $d(a,b) \le r$ must share at least one distinct
 * character with $a$ (unless $r = 1$, which includes everything).
 * A character inverted index (char → token ids) provides a sound
 * superset for both modes. Tokens with an empty character set have
 * no candidates (they are distance 1 from everything).
 *
 * ## Construction cost
 * $O(K \cdot \bar{c})$ to build the character inverted index, where
 * $\bar{c}$ is the average number of distinct characters per token.
 * Per-`candidates` cost is proportional to the number of index hits.
 */

import type { DistanceModel } from './distance-model.js';

export type CharOverlapMode = 'set' | 'multiset';

/**
 * Yield distinct code points of $s$ as strings.
 * Each code point is represented as a single-character string.
 */
function* codePoints(s: string): Generator<string> {
	for (const cp of s) {
		yield cp;
	}
}

/**
 * Build a character-count map for multiset mode.
 * Maps each distinct code point to its occurrence count.
 */
function charCounts(s: string): Map<string, number> {
	const counts = new Map<string, number>();
	for (const cp of s) {
		counts.set(cp, (counts.get(cp) ?? 0) + 1);
	}
	return counts;
}

export class CharOverlapModel implements DistanceModel {
	readonly id: string;
	readonly K: number;
	readonly mode: CharOverlapMode;

	// Set mode: distinct characters per token.
	private _charSets: Set<string>[];

	// Multiset mode: character counts per token.
	private _charCounts: Map<string, number>[] | null;

	// Built lazily on first candidates() call.
	private _index: Map<string, number[]> | null = null;

	constructor(strings: readonly string[], mode: CharOverlapMode = 'set') {
		this.mode = mode;
		this.id = mode === 'multiset' ? 'char-overlap-multiset' : 'char-overlap';
		this.K = strings.length;

		// Precompute per-token character data: O(K), cheap.
		this._charSets = new Array(this.K);
		this._charCounts = mode === 'multiset' ? new Array(this.K) : null;

		for (let i = 0; i < this.K; i++) {
			const s = strings[i]!;
			this._charSets[i] = new Set(codePoints(s));
			if (this._charCounts) {
				this._charCounts[i] = charCounts(s);
			}
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
	 * must share at least one distinct character. Tokens with an empty
	 * character set yield no candidates (they are distance 1 from
	 * everything).
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
	 * In **set** mode: $d = 1 - |A \cap B| / |A \cup B|$.
	 *
	 * In **multiset** mode:
	 * $d = 1 - \frac{\sum_c \min(n_a(c), n_b(c))}{\sum_c \max(n_a(c), n_b(c))}$.
	 *
	 * Returns the distance if $\le$ `maxDist`, or `maxDist + 1` otherwise.
	 * Symmetric: $d(a,b) = d(b,a)$. Self-distance is $0$.
	 */
	distance(a: number, b: number, maxDist: number): number {
		if (a === b) return 0;

		if (this._charCounts) {
			return this._multisetDistance(a, b, maxDist);
		}
		return this._setDistance(a, b, maxDist);
	}

	/** Set-mode Jaccard distance. */
	private _setDistance(a: number, b: number, maxDist: number): number {
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

	/** Multiset-mode Jaccard distance. */
	private _multisetDistance(a: number, b: number, maxDist: number): number {
		const countsA = this._charCounts![a]!;
		const countsB = this._charCounts![b]!;

		// Both empty → distance 1.
		if (countsA.size === 0 && countsB.size === 0) return 1 <= maxDist ? 1 : maxDist + 1;

		// One empty → distance 1.
		if (countsA.size === 0 || countsB.size === 0) return 1 <= maxDist ? 1 : maxDist + 1;

		// Sum min and max over the union of keys.
		// Iterate over the smaller map's keys first, then the larger's.
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

		// Keys only in the larger map contribute 0 to min, count to max.
		for (const [ch, countLarge] of large) {
			if (seen.has(ch)) continue;
			sumMax += countLarge;
		}

		const d = 1 - sumMin / sumMax;
		return d <= maxDist ? d : maxDist + 1;
	}
}
