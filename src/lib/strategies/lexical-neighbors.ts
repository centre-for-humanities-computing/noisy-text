/**
 * Precomputation of top-k edit-distance neighbor tables for the lexical strategy.
 *
 * ## Overview
 * Given the full vocabulary as decoded strings (one per token id), we build a
 * ragged CSR (Compressed Sparse Row) table mapping each token to its $k$ nearest
 * neighbors within edit distance `maxDistance`. Neighbor probabilities are
 * precomputed as softmax weights $w_{ij} \propto \exp(-d_{ij} / \tau)$.
 *
 * ## Candidate pruning (sound to radius)
 * For each token we find all neighbors within `maxDistance` using two sound
 * (no false exclusions) filters before exact Levenshtein:
 *
 * 1. **Length filter**: $|\,|a| - |b|\,| \le r$ (necessary condition for
 *    $d(a,b) \le r$).
 * 2. **Bigram count filter**: two strings within edit distance $r$ must share
 *    at least $\max(|G_a|, |G_b|) - 2r$ character bigrams, because a single
 *    edit affects at most 2 bigrams (for $q=2$).
 *
 * Candidates are gathered via a character-bigram inverted index, deduplicated,
 * filtered through both bounds, and then exactly compared via banded early-exit
 * Levenshtein.
 *
 * ## CSR layout
 * - `neighborIds[i]`: concatenated neighbor token ids
 * - `offsets[i]`: range `offsets[i]..offsets[i+1]` belongs to token $i$
 * - `weights[i]`: precomputed softmax weight (parallel to neighborIds)
 * - `K`: vocabulary size
 *
 * Tokens with zero in-radius neighbors produce empty ranges
 * (`offsets[i] = offsets[i+1]`). The ergodicity floor in the strategy
 * guarantees irreducibility regardless.
 */

/**
 * Per-token precomputed neighbor table in CSR layout.
 *
 * `neighborIds` and `weights` are parallel arrays. For token $i$,
 * its neighbors are in `neighborIds[offsets[i] .. offsets[i+1]]`
 * with corresponding softmax weights in the same range of `weights`.
 */
export interface LexicalNeighborTable {
	/** Concatenated neighbor token ids (CSR values). */
	readonly neighborIds: Int32Array;
	/** Offsets into `neighborIds`/`weights`. Length $K+1$. */
	readonly offsets: Int32Array;
	/** Precomputed softmax weights, parallel to `neighborIds`. */
	readonly weights: Float32Array;
	/** Vocabulary size $K$. */
	readonly K: number;
}

/** Parameters controlling neighbor table computation. */
export interface LexicalNeighborParams {
	/** Maximum edit distance for neighbor inclusion (radius). */
	maxDistance: number;
	/** Maximum number of neighbors per token (truncation). */
	k: number;
	/** Softmax temperature $\tau$. */
	tau: number;
}

/**
 * Normalize a raw token-string from the tokenizer into a clean form
 * for edit-distance comparison.
 *
 * - GPT-2: leading `Ġ` (U+0120) → space, then trim leading whitespace.
 * - BERT: leading `##` continuation marker → strip.
 * - Applies NFC normalization.
 */
export function normalizeTokenString(raw: string): string {
	let s = raw;
	// GPT-2 Ġ marker → space.
	if (s.startsWith('Ġ')) {
		s = ' ' + s.slice(1);
	}
	s = s.trimStart();
	// BERT continuation marker.
	if (s.startsWith('##')) {
		s = s.slice(2);
	}
	return s.normalize('NFC');
}

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
 * Build the top-$k$ neighbor table for `strings` (one per token id).
 *
 * `onProgress(done, total)` fires periodically; `total` is $K$.
 *
 * @param strings - Cleaned decoded token strings, index $=$ token id.
 * @param params - Neighbor computation parameters.
 * @param onProgress - Optional progress callback.
 * @returns The CSR neighbor table.
 */
export function computeNeighborTable(
	strings: readonly string[],
	params: LexicalNeighborParams,
	onProgress?: (done: number, total: number) => void,
): LexicalNeighborTable {
	const K = strings.length;
	const { maxDistance, k, tau } = params;

	// --- Precompute per-token properties ---
	const bigramSets: Set<string>[] = new Array(K);
	const lengths = new Int32Array(K);
	for (let i = 0; i < K; i++) {
		const bgs = new Set(bigrams(strings[i]!));
		bigramSets[i] = bgs;
		lengths[i] = strings[i]!.length;
	}

	// --- Build inverted index: bigram → list of token ids ---
	const index = new Map<string, number[]>();
	for (let i = 0; i < K; i++) {
		for (const bg of bigramSets[i]!) {
			let list = index.get(bg);
			if (!list) {
				list = [];
				index.set(bg, list);
			}
			list.push(i);
		}
	}

	// Pre-identify "sparse" tokens: those with $|G| \le 2r$.
	// When both query and target are sparse, the bigram-count sound bound
	// $\max(|G_a|, |G_b|) - 2r \le 0$ is trivially satisfied, so they
	// *could* be within distance $r$ even with completely disjoint bigram
	// sets. We scan these as supplements after the index pass — the index
	// cannot find such pairs. In practice, sparse tokens are a small
	// fraction of the vocab for typical $r \le 2$.
	const sparseTokens = new Set<number>();
	for (let i = 0; i < K; i++) {
		if (bigramSets[i]!.size <= 2 * maxDistance) {
			sparseTokens.add(i);
		}
	}

	// --- Per-token neighbor computation ---
	const allNeighborIds: number[] = [];
	const allWeights: number[] = [];
	const offsetList = new Int32Array(K + 1);
	const visited = new Uint8Array(K);
	let visitedGen = 0;

	for (let i = 0; i < K; i++) {
		visitedGen++;
		const lenI = lengths[i]!;
		const bgI = bigramSets[i]!;
		const pairs: { id: number; dist: number }[] = [];

		// Gather candidates from inverted index.
		if (bgI.size > 0) {
			for (const bg of bgI) {
				const candList = index.get(bg);
				if (!candList) continue;
				for (const j of candList) {
					if (j === i) continue;
					if (visited[j] === visitedGen) continue;
					visited[j] = visitedGen;

					// Length filter (sound lower bound).
					if (Math.abs(lenI - lengths[j]!) > maxDistance) continue;

					// Bigram-count sound bound.
					const bgJ = bigramSets[j]!;
					const needed = Math.max(bgI.size, bgJ.size) - 2 * maxDistance;
					if (needed > 0) {
						let shared = 0;
						const [smaller, larger] = bgI.size <= bgJ.size ? [bgI, bgJ] : [bgJ, bgI];
						for (const bg of smaller) {
							if (larger.has(bg)) shared++;
						}
						if (shared < needed) continue;
					}

					// Exact Levenshtein.
					const d = levenshtein(strings[i]!, strings[j]!, maxDistance);
					if (d <= maxDistance) {
						pairs.push({ id: j, dist: d });
					}
				}
			}
		}

		// Supplement: scan "sparse" tokens (those with $|G| \le 2r$).
		// When both query and target are sparse, the bigram-count sound bound
		// is trivially satisfied ($\max(|G_q|,|G_t|) - 2r \le 0$), so they
		// could be within distance $r$ even with completely disjoint bigram
		// sets. The inverted index cannot find these pairs — but the number
		// of sparse tokens per vocab is small for typical $r \le 2$.
		for (const j of sparseTokens) {
			if (j === i) continue;
			if (visited[j] === visitedGen) continue;
			visited[j] = visitedGen;
			if (Math.abs(lenI - lengths[j]!) > maxDistance) continue;
			const d = levenshtein(strings[i]!, strings[j]!, maxDistance);
			if (d <= maxDistance) {
				pairs.push({ id: j, dist: d });
			}
		}

		// When the query token itself has zero bigrams ($|s| < 2$), it
		// can't use the inverted index at all. Scan all tokens of similar
		// length as a fallback. Zero-bigram tokens are very rare in any
		// real vocabulary, so this is cheap.
		if (bgI.size === 0) {
			for (let j = 0; j < K; j++) {
				if (j === i) continue;
				if (visited[j] === visitedGen) continue;
				visited[j] = visitedGen;
				if (Math.abs(lenI - lengths[j]!) > maxDistance) continue;
				const d = levenshtein(strings[i]!, strings[j]!, maxDistance);
				if (d <= maxDistance) {
					pairs.push({ id: j, dist: d });
				}
			}
		}

		// Sort by distance ascending, truncate to top $k$.
		pairs.sort((a, b) => a.dist - b.dist);
		const topK = pairs.slice(0, k);

		// Compute softmax weights: $w_m = \exp(-d_m / \tau) / \sum_m \exp(-d_m / \tau)$.
		// Empty list → no weights pushed.
		offsetList[i + 1] = offsetList[i]! + topK.length;

		if (topK.length > 0) {
			const logits = topK.map((p) => -p.dist / tau);
			const maxLogit = Math.max(...logits);
			let sumExp = 0;
			for (const l of logits) sumExp += Math.exp(l - maxLogit);

			for (let m = 0; m < topK.length; m++) {
				allNeighborIds.push(topK[m]!.id);
				allWeights.push(Math.exp(logits[m]! - maxLogit) / sumExp);
			}
		}

		// Progress: report every 1024 tokens.
		if (onProgress && (i & 1023) === 0) {
			onProgress(i, K);
		}
	}

	if (onProgress) onProgress(K, K);

	return {
		neighborIds: new Int32Array(allNeighborIds),
		offsets: offsetList,
		weights: new Float32Array(allWeights),
		K,
	};
}