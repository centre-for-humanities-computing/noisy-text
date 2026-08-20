import type { NoiseStrategy, Rng, StrategyFactory } from './types.js';

/**
 * Configuration for the absorbing (mask) strategy.
 *
 * At each step, each non-mask token transitions to `maskTokenId` with
 * probability $\beta_t$. Once a token reaches the absorbing state, it
 * stays there:
 *
 * $$Q_t = (1 - \beta_t) I + \beta_t \, \mathbf{1} e_m^\top$$
 *
 * on non-absorbing rows, and row $m$ is $e_m$ (absorbing). The stationary
 * distribution is a point mass at the mask token.
 *
 * The mask token id is a reserved sentinel equal to `vocabSize` (one past
 * the real vocabulary), so the transition matrix is $(K+1) \times (K+1)$
 * where $K$ is the real vocab size.
 */
export interface AbsorbingConfig {
	/** The absorbing token id (reserved sentinel = `vocabSize`). */
	maskTokenId: number;
}

const ABSORBING_INFO = {
	id: 'absorbing',
	label: 'Absorbing (mask)',
	description: 'Each non-mask token becomes [MASK] with probability βₜ. Once masked, stays masked.',
	stationary: 'point-mass',
} as const;

/**
 * Create an absorbing (mask) strategy.
 *
 * `sampleStep` draws exactly 1 rng value per call so the RNG stream is
 * path-independent — this is documented in `engine/README.md`.
 *
 * `getLocalDistribution` returns a reused `Float32Array` buffer of length
 * `vocabSize + 1` (to hold the sentinel at index `maskTokenId`). Each call
 * overwrites it; callers must not retain the returned reference.
 */
export const createAbsorbing: StrategyFactory<AbsorbingConfig> = (
	config: AbsorbingConfig,
	vocabSize: number,
): NoiseStrategy<AbsorbingConfig> => {
	const { maskTokenId } = config;

	// Pre-allocated buffer for getLocalDistribution — reused across calls.
	// Length is vocabSize + 1 to hold the sentinel at index maskTokenId.
	const _dist = new Float32Array(vocabSize + 1);

	return {
		info: ABSORBING_INFO,
		config,

		sampleStep(token: number, beta: number, rng: Rng): number {
			// Absorbing state: once masked, always masked.
			if (token === maskTokenId) return maskTokenId;

			// Draw exactly 1 value to keep the RNG stream path-independent.
			// $P(x_{t+1} = m \mid x_t \neq m) = \beta_t$
			// $P(x_{t+1} = x_t \mid x_t \neq m) = 1 - \beta_t$
			if (rng() < beta) return maskTokenId;
			return token;
		},

		getLocalDistribution(token: number, beta: number): Float32Array {
			// Row $m$ (absorbing): one-hot at $m$.
			if (token === maskTokenId) {
				_dist.fill(0);
				_dist[maskTokenId] = 1;
				return _dist;
			}

			// Non-absorbing row: $P(x_t \mid x_t) = 1 - \beta$,
			// $P(m \mid x_t) = \beta$, all others 0.
			_dist.fill(0);
			_dist[token] = 1 - beta;
			_dist[maskTokenId] = beta;
			return _dist;
		},
	};
};
