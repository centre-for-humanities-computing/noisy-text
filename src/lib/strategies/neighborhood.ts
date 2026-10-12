/**
 * Lazy neighborhood computation backed by a `DistanceModel`.
 *
 * A `NeighborhoodProvider` computes and caches the neighborhood of a token
 * on first access. Neighborhoods are distance-sorted lists of
 * `(id, dist)` pairs out to a fixed ceiling $R_{\max}$. All parameter
 * filtering ($k$, `maxDistance`, $\tau$, $\varepsilon$) happens at read
 * time in the strategy — the provider stores only raw distances.
 *
 * A symmetric pair-cache memoizes individual $d(a,b)$ lookups so that
 * computing the neighborhood of $a$ also populates distances for $b$,
 * avoiding redundant Levenshtein calls when $b$ is later visited.
 *
 * Both caches are bounded (see `NeighborhoodProviderOptions`). The bounds
 * are what keeps large vocabularies workable: with $R_{\max} = 1$ every
 * token is a neighbor of almost every other, so an unbounded cache would
 * hold $K$ entries per visited token.
 */

import type { DistanceModel } from './distance-model.js';

/** A single neighbor entry: token id and raw distance. */
export interface NeighborEntry {
	readonly id: number;
	readonly dist: number;
}

/** Default bound on memoized pair distances (about one million entries). */
export const DEFAULT_MAX_PAIRS = 1 << 20;

/** Memory bounds for a `NeighborhoodProvider`. */
export interface NeighborhoodProviderOptions {
	/**
	 * Keep only the `maxStored` nearest neighbors per token. Read-time
	 * filtering takes the first $k$ entries within `maxDistance`, so any
	 * cap $\ge k$ leaves every read unchanged. Default: unbounded.
	 */
	maxStored?: number;
	/**
	 * Upper bound on memoized pair distances. Past it, distances are
	 * recomputed when needed instead of cached. Default: `DEFAULT_MAX_PAIRS`.
	 */
	maxPairs?: number;
}

/**
 * Lazy neighborhood provider.
 *
 * Given a `DistanceModel` and a fixed radius ceiling $R_{\max}$, provides
 * `neighborsOf(token)` returning the neighbors within $R_{\max}$, sorted
 * by distance ascending (nearest first, truncated to `maxStored`).
 * Results are memoized per token.
 *
 * The pair-cache exploits symmetry: when $d(a,b)$ is computed during
 * $a$'s neighborhood scan, it is stored under both $(a,b)$ and $(b,a)$
 * so that $b$'s later neighborhood scan can skip the Levenshtein call.
 */
export class NeighborhoodProvider {
	readonly R_MAX: number;
	readonly K: number;

	private _model: DistanceModel;
	private readonly _maxStored: number;
	private readonly _maxPairs: number;

	/** Per-token memo: `token → NeighborEntry[]` (sorted by dist). */
	private _neighbors: (NeighborEntry[] | undefined)[];

	/**
	 * Pair-cache: key = $\min(a,b) \cdot K + \max(a,b)$, value = distance.
	 * Filled during neighbor scans and bounded by `_maxPairs`.
	 */
	private _pairCache: Map<number, number> = new Map();

	constructor(model: DistanceModel, R_MAX: number, opts: NeighborhoodProviderOptions = {}) {
		this._model = model;
		this.R_MAX = R_MAX;
		this.K = model.K;
		this._neighbors = new Array(model.K);
		this._maxStored = opts.maxStored ?? Infinity;
		this._maxPairs = opts.maxPairs ?? DEFAULT_MAX_PAIRS;
	}

	/**
	 * Return the neighbors of `token` within $R_{\max}$, sorted by distance
	 * ascending and truncated to the `maxStored` nearest. Computed lazily on
	 * first access; cached thereafter.
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
		if (entries.length > this._maxStored) entries.length = this._maxStored;
		this._neighbors[token] = entries;
		return entries;
	}

	/**
	 * Look up $d(a,b)$ from the pair-cache, computing it if needed.
	 * Stores the result symmetrically while the cache has room.
	 */
	private _pairDistance(a: number, b: number): number {
		const key = a < b ? a * this.K + b : b * this.K + a;
		const cached = this._pairCache.get(key);
		if (cached !== undefined) return cached;

		const d = this._model.distance(a, b, this.R_MAX);
		if (this._pairCache.size < this._maxPairs) this._pairCache.set(key, d);
		return d;
	}
}
