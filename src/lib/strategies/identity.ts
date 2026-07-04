import type { NoiseStrategy, Rng, StrategyFactory } from './types.js';

/**
 * Configuration for the identity strategy (no knobs).
 *
 * The identity strategy applies no noise: $Q_t = I$ for all $t$,
 * so $x_{t+1} = x_t$ deterministically.
 */
export type IdentityConfig = Record<string, never>;

const IDENTITY_INFO = {
	id: 'identity',
	label: 'Identity (no noise)',
	description: 'No noise applied. Every token stays as itself at every timestep.',
	stationary: 'point-mass',
} as const;

/**
 * Create an identity strategy.
 *
 * $Q_t = I$ for all $t$, so `sampleStep` always returns the input token.
 * `getLocalDistribution` returns a one-hot vector at the input token.
 */
export const createIdentity: StrategyFactory<IdentityConfig> = (
	_config: IdentityConfig,
	vocabSize: number,
): NoiseStrategy<IdentityConfig> => {
	// Pre-allocate the one-hot buffer for getLocalDistribution.
	// Reused across calls; each call overwrites it.
	const _oneHot = new Float32Array(vocabSize);

	return {
		info: IDENTITY_INFO,
		config: {},

		sampleStep(token: number, _t: number, _rng: Rng): number {
			// $Q_t = I$, so $x_{t+1} = x_t$ deterministically.
			return token;
		},

		getLocalDistribution(token: number, _t: number): Float32Array {
			// One-hot at `token`: $P(x_{t+1} = j \mid x_t) = \delta_{j, x_t}$.
			_oneHot.fill(0);
			_oneHot[token] = 1;
			return _oneHot;
		},
	};
};
