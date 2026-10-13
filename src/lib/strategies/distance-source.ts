/**
 * Neighbor-table producer — the "where do tokens go" substrate shared by
 * distance-based kernels.
 *
 * A `DistanceSource` exposes top-$k$ neighbor tables and raw pair
 * distances. It is the unit a persistent cache would key on: its identity
 * is `(id, params)` — the distance model id plus the parameters that
 * shape the stored table (radius ceiling, store limit). Read-time kernel
 * parameters ($\tau$, weight family, $\varepsilon$, $k$, `maxDistance`)
 * are deliberately *not* part of the identity, so changing them never
 * invalidates the neighbor table.
 *
 * `ModelDistanceSource` is the thin adapter over the existing
 * `DistanceModel` + `NeighborhoodProvider` substrate: it reuses the
 * provider's lazy, memoized, distance-sorted neighbor lists.
 */

import type { DistanceModel } from './distance-model.js';
import type { NeighborhoodProvider } from './neighborhood.js';

/** A top-$k$ neighbor table for one token: ids aligned with distances. */
export interface NeighborTable {
	readonly ids: Int32Array;
	readonly dists: Float32Array;
}

/**
 * Neighbor-table producer keyed by `(id, params)`.
 *
 * `topK` returns the top-$k$ nearest tokens within `maxDistance`, self
 * excluded, ascending by distance. `distance` returns the raw distance
 * capped at the source's radius ceiling (values beyond it come back as
 * ceiling + 1, matching `DistanceModel.distance`).
 */
export interface DistanceSource {
	/** Stable id (the distance model's id), e.g. `'edit-distance'`. */
	readonly id: string;
	/** Serializable, informational params that shape the stored table. */
	readonly params: Record<string, unknown>;
	/** Vocabulary size $K$. */
	readonly vocabSize: number;
	topK(tokenId: number, k: number, maxDistance: number): NeighborTable;
	distance(a: number, b: number): number;
}

export interface ModelDistanceSourceOptions {
	/**
	 * Store limit recorded in `params` for cache keying. Informational
	 * only — the underlying provider already truncates. `null` (default)
	 * means unbounded.
	 */
	maxStored?: number;
}

/**
 * `DistanceSource` backed by a `DistanceModel` + `NeighborhoodProvider`.
 *
 * The provider's neighbor lists are already distance-sorted, self-
 * excluded, and truncated to the provider's store limit, so `topK` only
 * applies the read-time filters (`maxDistance`, $k$) and copies into
 * typed arrays.
 */
export class ModelDistanceSource implements DistanceSource {
	readonly id: string;
	readonly params: Record<string, unknown>;
	readonly vocabSize: number;

	private readonly _model: DistanceModel;
	private readonly _provider: NeighborhoodProvider;

	constructor(
		model: DistanceModel,
		provider: NeighborhoodProvider,
		opts?: ModelDistanceSourceOptions,
	) {
		this._model = model;
		this._provider = provider;
		this.id = model.id;
		this.vocabSize = model.K;
		this.params = { rMax: provider.R_MAX, maxStored: opts?.maxStored ?? null };
	}

	/**
	 * Top-$k$ nearest neighbors of `tokenId` within `maxDistance`, self
	 * excluded, ascending by distance.
	 */
	topK(tokenId: number, k: number, maxDistance: number): NeighborTable {
		const neighbors = this._provider.neighborsOf(tokenId);
		const ids: number[] = [];
		const dists: number[] = [];
		for (let i = 0; i < neighbors.length && ids.length < k; i++) {
			const n = neighbors[i]!;
			if (n.id === tokenId) continue; // defensive: providers already skip self
			if (n.dist > maxDistance) continue;
			ids.push(n.id);
			dists.push(n.dist);
		}
		return { ids: Int32Array.from(ids), dists: Float32Array.from(dists) };
	}

	/** Raw distance, capped at the provider's radius ceiling $R_{\max}$. */
	distance(a: number, b: number): number {
		return this._model.distance(a, b, this._provider.R_MAX);
	}
}
