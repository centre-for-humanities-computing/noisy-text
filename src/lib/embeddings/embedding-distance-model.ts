import type { DistanceModel } from '../strategies/distance-model.js';
import type { EmbeddingKnnIndex } from './knn-index.js';

/**
 * `DistanceModel` adapter over an `EmbeddingKnnIndex`.
 *
 * ## Soundness semantics (different from the string models)
 *
 * `candidates(token, _radius)` returns the token's memoized top-$M$
 * embedding neighbours (filtered by the token predicate) — a $k$NN
 * neighbourhood, **not** everything within `radius`. This is sound only
 * under the kNN interpretation: the strategy's neighbourhood *is* the
 * top-$M$ list, so `maxDistance` acts as an optional secondary cutoff
 * (the provider passes $R_{\max} = \infty$, i.e. no cutoff).
 *
 * `distance(a, b, maxDist)` returns the metric distance when
 * $\le$ `maxDist`, else `maxDist + 1` (the `DistanceModel` convention).
 */
export class EmbeddingDistanceModel implements DistanceModel {
	readonly id: string;
	readonly K: number;

	private readonly _index: EmbeddingKnnIndex;
	private readonly _predicate: (id: number) => boolean;

	constructor(
		index: EmbeddingKnnIndex,
		predicate: (id: number) => boolean,
		sourceId: string,
		preprocessId: string,
		metricId: string,
	) {
		this._index = index;
		this._predicate = predicate;
		this.id = `embedding:${sourceId}:${preprocessId}:${metricId}`;
		this.K = index.matrix.vocabSize;
	}

	/**
	 * The token's top-$M$ embedding neighbours passing `predicate`.
	 * `radius` is ignored (kNN semantics; see the class doc).
	 */
	*candidates(token: number, _radius: number): Iterable<number> {
		// Ids outside the matrix (per-input OOV words) have no row: no
		// neighbours, so the kernel falls back to the uniform floor.
		if (token < 0 || token >= this.K) return;
		const { ids } = this._index.topM(token);
		for (let i = 0; i < ids.length; i++) {
			const j = ids[i]!;
			if (this._predicate(j)) yield j;
		}
	}

	distance(a: number, b: number, maxDist: number): number {
		const d = this._index.distance(a, b);
		return d <= maxDist ? d : maxDist + 1;
	}
}
