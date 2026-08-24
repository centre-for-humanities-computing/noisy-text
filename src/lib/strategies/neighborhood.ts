/**
 * Lazy neighborhood computation backed by a `DistanceModel`.
 *
 * A `NeighborhoodProvider` computes and caches the neighborhood of a token
 * on first access. Neighborhoods are stored as distance-sorted lists of
 * `(id, dist)` pairs out to a fixed ceiling $R_{\max}$. All parameter
 * filtering ($k$, `maxDistance`, $\tau$, $\varepsilon$) happens at read
 * time in the strategy — the provider stores only raw distances.
 *
 * A symmetric pair-cache memoizes individual $d(a,b)$ lookups so that
 * computing the neighborhood of $a$ also populates distances for $b$,
 * avoiding redundant Levenshtein calls when $b$ is later visited.
 */

import type { DistanceModel } from './distance-model.js';

/** A single neighbor entry: token id and raw distance. */
export interface NeighborEntry {
	readonly id: number;
	readonly dist: number;
}

/**
 * Lazy neighborhood provider.
 *
 * Given a `DistanceModel` and a fixed radius ceiling $R_{\max}$, provides
 * `neighborsOf(token)` returning all neighbors within $R_{\max}$, sorted
 * by distance ascending. Results are memoized per token.
 *
 * The pair-cache exploits symmetry: when $d(a,b)$ is computed during
 * $a$'s neighborhood scan, it is stored under both $(a,b)$ and $(b,a)$
 * so that $b$'s later neighborhood scan can skip the Levenshtein call.
 */
export class NeighborhoodProvider {
	readonly R_MAX: number;
	readonly K: number;

	private _model: DistanceModel;

	/** Per-token memo: `token → NeighborEntry[]` (sorted by dist). */
	private _neighbors: (NeighborEntry[] | undefined)[];

	/**
	 * Pair-cache: key = $\min(a,b) \cdot K + \max(a,b)$, value = distance.
	 * Only stores distances $\le$ `R_MAX`; misses mean "not within R_MAX"
	 * (or not yet computed).
	 */
	private _pairCache: Map<number, number> = new Map();

	constructor(model: DistanceModel, R_MAX: number) {
		this._model = model;
		this.R_MAX = R_MAX;
		this.K = model.K;
		this._neighbors = new Array(model.K);
	}

	/**
	 * Return all neighbors of `token` within $R_{\max}$, sorted by
	 * distance ascending. Computed lazily on first access; cached
	 * thereafter.
	 */
	neighborsOf(token: number): readonly NeighborEntry[] {
		const cached = this._neighbors[token];
		if (cached) return cached;

		const entries: NeighborEntry[] = [];

		for (const j of this._model.candidates(token, this.R_MAX)) {
			const d = this._pairDistance(token, j);
			if (d <= this.R_MAX) {
				entries.push({ id: j, dist: d });
			}
		}

		entries.sort((a, b) => a.dist - b.dist);
		this._neighbors[token] = entries;
		return entries;
	}

	/**
	 * Look up $d(a,b)$ from the pair-cache, computing it if needed.
	 * Stores the result symmetrically.
	 */
	private _pairDistance(a: number, b: number): number {
		const key = a < b ? a * this.K + b : b * this.K + a;
		const cached = this._pairCache.get(key);
		if (cached !== undefined) return cached;

		const d = this._model.distance(a, b, this.R_MAX);
		this._pairCache.set(key, d);
		return d;
	}
}