/**
 * Cheap transition kernel derived from a `DistanceSource` at sample time.
 *
 * A `TokenKernel` turns a neighbor table plus a weight family into the
 * sparse rows of the jump kernel $K_\tau$:
 *
 * $$K_\tau(y \mid x) \propto w(d(x,y);\, \tau), \quad y \in N_k(x)$$
 *
 * where $N_k(x)$ is the top-$k$ neighbor table of $x$ within
 * `maxDistance`, self excluded. Rows are memoized per token for the
 * lifetime of the kernel instance (kernel parameters are fixed at
 * construction, so a parameter change means a new kernel and a fresh
 * memo — the neighbor-table cache upstream is unaffected).
 *
 * The ergodicity floor $\varepsilon$ is folded into `sampleStep`: with
 * probability $\varepsilon$ the draw is uniform over the whole vocab,
 * otherwise it is the inverse-CDF sample over the kernel row. `getRow`
 * returns the *unmixed* kernel row (no floor); dense mixing with the
 * floor is `kernelRowToDense`.
 */

import type { Rng } from './types.js';
import type { DistanceSource } from './distance-source.js';
import { clampTau } from './weight-family.js';
import type { WeightFamily } from './weight-family.js';

/** One sparse row of $K_\tau$: neighbor ids aligned with probabilities. */
export interface KernelRow {
	readonly ids: Int32Array;
	readonly probs: Float32Array;
}

export interface TokenKernel {
	/**
	 * Sample $j \sim K_\tau(\cdot \mid \text{token})$ with the ergodicity
	 * floor folded in. Draws exactly 1 rng value.
	 */
	sampleStep(token: number, rng: Rng): number;
	/**
	 * Sparse row of $K_\tau$: self excluded, probabilities sum to 1 over
	 * `ids`. Empty (length 0) if the token has no neighbors in range.
	 */
	getRow(token: number): KernelRow;
	/**
	 * $\log K$-weight for log-space composition over the jump (used by
	 * graph tooling, not by sampling).
	 */
	logWeight?(i: number, j: number): number;
}

export interface KernelParams {
	k: number;
	maxDistance: number;
	tau: number;
	epsilon: number;
	vocabSize: number;
}

/**
 * Build a `TokenKernel` over a `DistanceSource` and a weight family.
 *
 * Row computation is a max-subtracted softmax in log space over the
 * family's `logWeight`, matching the legacy neighbor softmax bit-for-bit
 * for the exponential family.
 */
export function createTokenKernel(
	source: DistanceSource,
	family: WeightFamily,
	params: KernelParams,
): TokenKernel {
	const { k, maxDistance, epsilon, vocabSize } = params;
	// Clamp the temperature once: non-positive or non-finite $\tau$ would
	// produce non-finite log-weights; the $\tau \to 0$ limit is the
	// nearest-neighbor collapse instead.
	const tau = clampTau(params.tau);

	// Per-token memo: token → kernel row (empty rows memoized too).
	const rows = new Map<number, KernelRow>();

	const getRow = (token: number): KernelRow => {
		const cached = rows.get(token);
		if (cached) return cached;

		const table = source.topK(token, k, maxDistance);
		let row: KernelRow;
		if (table.ids.length === 0) {
			row = { ids: new Int32Array(0), probs: new Float32Array(0) };
		} else {
			// Log-space softmax: $p_m = \exp(\ell_m - \max \ell) / \sum \exp(\ell_j - \max \ell)$.
			const n = table.ids.length;
			const logWeights: number[] = new Array(n);
			for (let i = 0; i < n; i++) logWeights[i] = family.logWeight(table.dists[i]!, tau);
			const maxLogit = Math.max(...logWeights);
			let sumExp = 0;
			for (const l of logWeights) sumExp += Math.exp(l - maxLogit);
			const probs = new Float32Array(n);
			for (let i = 0; i < n; i++) probs[i] = Math.exp(logWeights[i]! - maxLogit) / sumExp;
			row = { ids: table.ids, probs };
		}
		rows.set(token, row);
		return row;
	};

	return {
		sampleStep(token: number, rng: Rng): number {
			const draw = rng();

			// Ergodicity floor: with probability $\varepsilon$, uniform over vocab.
			if (epsilon > 0 && draw < epsilon) {
				return Math.min(Math.floor((draw / epsilon) * vocabSize), vocabSize - 1);
			}

			const row = getRow(token);

			// No neighbors in range → uniform over vocab.
			if (row.ids.length === 0) {
				return Math.min(Math.floor(draw * vocabSize), vocabSize - 1);
			}

			// Inverse-CDF over the kernel row.
			const v = epsilon > 0 ? (draw - epsilon) / (1 - epsilon) : draw;
			let cum = 0;
			for (let i = 0; i < row.probs.length; i++) {
				cum += row.probs[i]!;
				if (v < cum) return row.ids[i]!;
			}
			return row.ids[row.ids.length - 1]!;
		},

		getRow,

		logWeight(i: number, j: number): number {
			return family.logWeight(source.distance(i, j), tau);
		},
	};
}

/**
 * Uniform kernel over the whole vocabulary (no neighbor table).
 *
 * `sampleStep` uses the direct floor formula — matching the legacy
 * uniform strategy's sampling exactly — with the same $\varepsilon$
 * floor branch as `createTokenKernel`. `getRow` returns the uniform row.
 */
export function createUniformKernel(vocabSize: number, epsilon: number): TokenKernel {
	return {
		sampleStep(token: number, rng: Rng): number {
			const draw = rng();
			if (epsilon > 0 && draw < epsilon) {
				return Math.min(Math.floor((draw / epsilon) * vocabSize), vocabSize - 1);
			}
			return Math.min(Math.floor(draw * vocabSize), vocabSize - 1);
		},

		getRow(_token: number): KernelRow {
			const p = 1 / vocabSize;
			const ids = new Int32Array(vocabSize);
			const probs = new Float32Array(vocabSize);
			for (let i = 0; i < vocabSize; i++) {
				ids[i] = i;
				probs[i] = p;
			}
			return { ids, probs };
		},
	};
}

/**
 * Fill a dense jump row from a sparse kernel row with the ergodicity
 * floor mixed in:
 *
 * $$P(y \mid x) = (1 - \varepsilon) \cdot K_\tau(y \mid x) + \varepsilon / K$$
 *
 * An empty kernel row (no neighbors in range) is normalized to uniform
 * so every dense row sums to 1.
 *
 * @param dist - Pre-allocated `Float32Array` of length `vocabSize`.
 * @param row - Sparse kernel row for the token.
 * @param epsilon - Ergodicity floor $\varepsilon \in [0, 1]$.
 * @param vocabSize - Vocabulary size $K$.
 * @returns The same `dist` array (for chaining).
 */
export function kernelRowToDense(
	dist: Float32Array,
	row: KernelRow,
	epsilon: number,
	vocabSize: number,
): Float32Array {
	if (row.ids.length === 0) {
		dist.fill(1 / vocabSize);
		return dist;
	}
	dist.fill(epsilon / vocabSize);
	for (let i = 0; i < row.ids.length; i++) {
		const id = row.ids[i]!;
		dist[id]! += (1 - epsilon) * row.probs[i]!;
	}
	return dist;
}
