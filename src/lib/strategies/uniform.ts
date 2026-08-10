import type { NoiseStrategy, Rng, StrategyFactory } from './types.js';

/**
 * Configuration for the uniform strategy (no knobs).
 *
 * At each step, each token transitions to a uniformly random vocab token
 * with probability $\beta_t$, otherwise stays unchanged:
 *
 * $$Q_t = (1 - \beta_t) I + \frac{\beta_t}{K} \mathbf{1}\mathbf{1}^\top$$
 *
 * So $P(x_{t+1} = x \mid x_t = x) = 1 - \beta_t + \beta_t / K$ and
 * $P(x_{t+1} = y \neq x) = \beta_t / K$. The stationary distribution is the
 * uniform distribution over the vocab.
 */
export type UniformConfig = Record<string, never>;

const UNIFORM_INFO = {
	id: 'uniform',
	label: 'Uniform',
	description: 'Each token independently samples uniformly from the vocab with probability βₜ.',
	stationary: 'uniform',
} as const;

/**
 * Create a uniform strategy.
 *
 * `sampleStep` draws exactly 2 rng values per call so the RNG stream is
 * path-independent — this is documented in `engine/README.md`.
 *
 * `getLocalDistribution` returns a reused `Float32Array` buffer. Each call
 * overwrites it; callers must not retain the returned reference.
 */
export const createUniform: StrategyFactory<UniformConfig> = (
	_config: UniformConfig,
	vocabSize: number,
): NoiseStrategy<UniformConfig> => {
	// Pre-allocated buffer for getLocalDistribution — reused across calls.
	// Callers must not retain the returned reference.
	const _dist = new Float32Array(vocabSize);

	return {
		info: UNIFORM_INFO,
		config: {},

		sampleStep(token: number, beta: number, rng: Rng): number {
			// Draw exactly 2 values to keep the RNG stream path-independent.
			const coin = rng(); // whether to resample
			const draw = rng(); // which token to pick

			if (coin < beta) {
				// Resample uniformly over the vocab (may land back on `token`).
				const idx = Math.min(Math.floor(draw * vocabSize), vocabSize - 1);
				return idx;
			}
			return token;
		},

		getLocalDistribution(token: number, beta: number): Float32Array {
			// $P(y \mid x) = \beta / K$ for all $y$, plus $1 - \beta$ on the diagonal.
			_dist.fill(beta / vocabSize);
			_dist[token]! += 1 - beta;
			return _dist;
		},
	};
};