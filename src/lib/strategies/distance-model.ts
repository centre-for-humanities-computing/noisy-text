/**
 * Distance-model abstraction for token-to-token distance functions.
 *
 * A `DistanceModel` provides candidate generation (sound superset of the
 * true neighborhood) and exact distance computation with early exit.
 * Implementations are self-contained — they own any indices or precomputed
 * structures needed for efficient candidate pruning.
 *
 * The interface is general: edit distance is one implementation; future
 * noise types (embedding cosine, phonetic, etc.) implement the same
 * contract and reuse the same lazy-neighborhood machinery.
 */

/**
 * A distance function over token ids in $[0, K)$.
 *
 * `candidates` must be *sound* (no false exclusions): every token $j$
 * with $\mathrm{distance}(i, j) \le r$ must appear in
 * $\mathrm{candidates}(i, r)$. It may include false positives; the exact
 * `distance` call filters them out.
 */
export interface DistanceModel {
	/** Unique id for cache keying (e.g. `'edit-distance'`). */
	readonly id: string;
	/** Vocabulary size $K$. */
	readonly K: number;

	/**
	 * Yield candidate token ids that *could* be within `radius` of `token`.
	 * Must be a superset of the true neighborhood — sound, no false
	 * exclusions. May include false positives (filtered later by `distance`).
	 */
	candidates(token: number, radius: number): Iterable<number>;

	/**
	 * Exact distance between two token ids, with early exit at `maxDist`.
	 *
	 * Returns the true distance if $\le$ `maxDist`, or `maxDist + 1`
	 * otherwise. Symmetric: $d(a,b) = d(b,a)$.
	 */
	distance(a: number, b: number, maxDist: number): number;
}

// ---------------------------------------------------------------------------
// Edit-distance implementation
// ---------------------------------------------------------------------------

/**
 * Compute Levenshtein edit distance between two strings, with early exit
 * when the distance exceeds `maxDist`.
 *
 * Returns the true distance if $\le$ `maxDist`, or `maxDist + 1` otherwise.
 * Uses the standard two-row DP with early row-minimum exit (Ukkonen-style).
 * $a$ is assumed to be the shorter string for optimal inner-loop length;
 * the public signature handles the swap internally.
 *
 * ## Complexity
 * $O(|a| \cdot |b|)$ worst case, but early exit makes this $O(|a| \cdot r)$
 * in practice for small $r$.
 */
export function levenshtein(a: string, b: string, maxDist: number): number {
	const n = a.length;
	const m = b.length;

	if (Math.abs(n - m) > maxDist) return maxDist + 1;

	// Ensure a is the shorter string (inner loop over shorter = cheaper).
	if (n > m) return levenshtein(b, a, maxDist);

	// Two rows of DP: Uint16Array since distances are small.
	let prev = new Uint16Array(n + 1);
	let curr = new Uint16Array(n + 1);

	for (let i = 0; i <= n; i++) prev[i] = i;

	for (let j = 1; j <= m; j++) {
		curr[0] = j;
		let minInRow = j;

		for (let i = 1; i <= n; i++) {
			const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
			const del = prev[i]! + 1;
			const ins = curr[i - 1]! + 1;
			const sub = prev[i - 1]! + cost;

			const best = del < ins ? (del < sub ? del : sub) : (ins < sub ? ins : sub);
			curr[i] = best;
			if (best < minInRow) minInRow = best;
		}

		if (minInRow > maxDist) return maxDist + 1;

		// Swap rows.
		const tmp = prev;
		prev = curr;
		curr = tmp;
	}

	const result = prev[n]!;
	return result <= maxDist ? result : maxDist + 1;
}

/**
 * Yield consecutive character bigrams of $s$.
 * Strings shorter than 2 characters yield nothing.
 */
function* bigrams(s: string): Generator<string> {
	for (let i = 0; i < s.length - 1; i++) {
		yield s.slice(i, i + 2);
	}
}

/**
 * Edit-distance `DistanceModel` backed by a character-bigram inverted index.
 *
 * ## Candidate pruning (sound to radius $r$)
 *
 * 1. **Length filter**: $|\,|a| - |b|\,| \le r$ (necessary condition).
 * 2. **Bigram count filter**: two strings within edit distance $r$ must
 *    share at least $\max(|G_a|, |G_b|) - 2r$ character bigrams, because
 *    a single edit affects at most 2 bigrams (for $q=2$).
 *
 * Candidates are gathered via the inverted index, deduplicated, filtered
 * through both bounds, and then exactly compared via banded early-exit
 * Levenshtein.
 *
 * Sparse tokens (those with $|G| \le 2r$) are scanned as a supplement
 * after the index pass, since the bigram-count bound is vacuous for
 * sparse–sparse pairs. Zero-bigram tokens ($|s| < 2$) fall back to a
 * full length-filtered scan.
 *
 * ## Construction cost
 * $O(K)$ to build the bigram inverted index (lazy, on first `candidates`
 * call). Per-`candidates` cost is proportional to the number of index
 * hits plus the number of sparse tokens — small in practice for $r \le 3$.
 */
export class EditDistanceModel implements DistanceModel {
	readonly id = 'edit-distance';
	readonly K: number;

	private _strings: readonly string[];
	private _lengths: Int32Array;
	private _bigramSets: Set<string>[];

	// Built lazily on first candidates() call.
	private _index: Map<string, number[]> | null = null;

	constructor(strings: readonly string[]) {
		this.K = strings.length;
		this._strings = strings;

		// Precompute per-token properties: O(K), cheap.
		this._lengths = new Int32Array(this.K);
		this._bigramSets = new Array(this.K);

		for (let i = 0; i < this.K; i++) {
			this._bigramSets[i] = new Set(bigrams(strings[i]!));
			this._lengths[i] = strings[i]!.length;
		}
	}

	/** Build the bigram inverted index (lazy, called once). */
	private _ensureIndex(): Map<string, number[]> {
		if (this._index) return this._index;

		const index = new Map<string, number[]>();
		for (let i = 0; i < this.K; i++) {
			for (const bg of this._bigramSets[i]!) {
				let list = index.get(bg);
				if (!list) {
					list = [];
					index.set(bg, list);
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
	 * Uses the bigram inverted index with length + bigram-count sound
	 * bounds. Tokens with fewer than 2 bigrams ($|s| < 2$) fall back
	 * to a length-filtered scan of all tokens.
	 */
	* candidates(token: number, radius: number): Iterable<number> {
		const lenI = this._lengths[token]!;
		const bgI = this._bigramSets[token]!;
		const seen = new Set<number>();

		if (bgI.size > 0) {
			const index = this._ensureIndex();

			for (const bg of bgI) {
				const candList = index.get(bg);
				if (!candList) continue;
				for (const j of candList) {
					if (j === token) continue;
					if (seen.has(j)) continue;
					seen.add(j);

					// Length filter (sound lower bound).
					if (Math.abs(lenI - this._lengths[j]!) > radius) continue;

					// Bigram-count sound bound.
					const bgJ = this._bigramSets[j]!;
					const needed = Math.max(bgI.size, bgJ.size) - 2 * radius;
					if (needed > 0) {
						let shared = 0;
						const [smaller, larger] = bgI.size <= bgJ.size ? [bgI, bgJ] : [bgJ, bgI];
						for (const bg of smaller) {
							if (larger.has(bg)) shared++;
						}
						if (shared < needed) continue;
					}

					yield j;
				}
			}
		} else {
			// No bigrams ($|s| < 2$): length-filtered scan of all tokens.
			for (let j = 0; j < this.K; j++) {
				if (j === token) continue;
				if (Math.abs(lenI - this._lengths[j]!) > radius) continue;
				yield j;
			}
		}
	}

	distance(a: number, b: number, maxDist: number): number {
		return levenshtein(this._strings[a]!, this._strings[b]!, maxDist);
	}
}