import type { NoiseStrategy, Rng, StrategyFactory } from './types.js';
import type { NeighborhoodProvider } from './neighborhood.js';
import { fillLocalDistribution, resolveNeighbors, sampleFromResolved } from './neighbor-softmax.js';

/**
 * Configuration for the character-overlap strategy.
 *
 * At each step, a token $x$ stays with probability $1-\beta_t$, or jumps
 * with probability $\beta_t$ to a destination $y$ drawn from:
 *
 * $$P(y \mid x) = (1 - \varepsilon) \cdot \mathrm{overlap}(y \mid x) + \varepsilon / K$$
 *
 * where $\mathrm{overlap}(y \mid x)$ is a softmax over negative Jaccard
 * distances to $x$'s neighbor list $N(x)$ (all neighbors within
 * $R_{\max}$, filtered to $\le$ `maxDistance` and truncated to top-$k$):
 *
 * $$\mathrm{overlap}(y \mid x) \propto \begin{cases}
 *   \exp(-d(x, y) / \tau) & y \in N(x),\ d(x,y) \le \text{maxDistance} \\
 *   0 & \text{otherwise}
 * \end{cases}$$
 *
 * where $d(x,y) = 1 - J(C(x), C(y))$ is the Jaccard distance over the
 * character sets (code points) of the raw subword strings.
 *
 * If $N(x) = \varnothing$ the overlap term vanishes and $P(y \mid x) = 1/K$
 * (pure uniform). The ergodicity floor $\varepsilon$ guarantees irreducibility
 * regardless of the neighbor table quality.
 *
 * All parameters ($k$, `maxDistance`, $\tau$, $\varepsilon$) are applied at
 * **read time** from `config`. The `NeighborhoodProvider` stores only raw
 * distances out to a fixed ceiling $R_{\max}$, so changing any of these
 * four parameters never triggers a recompute.
 */
export interface CharOverlapConfig {
	/** Maximum Jaccard distance for neighbor inclusion (radius, in $[0,1]$). */
	maxDistance: number;
	/** Maximum number of neighbors per token (list truncation). */
	k: number;
	/** Ergodicity floor $\varepsilon \in [0, 1]$. */
	epsilon: number;
	/** Softmax temperature $\tau$. */
	tau: number;
}

const CHAR_OVERLAP_INFO = {
	id: 'char-overlap',
	label: 'Character overlap (Jaccard)',
	description:
		'Tokens transition to tokens with similar character sets based on Jaccard distance, mixed with uniform noise.',
	stationary: 'data-dependent',
} as const;

/**
 * Create a character-overlap strategy.
 *
 * `sampleStep` draws exactly 2 rng values per call so the RNG stream is
 * path-independent — this is documented in `engine/README.md`.
 *
 * `getLocalDistribution` returns a reused `Float32Array` buffer of length
 * `vocabSize`. Each call overwrites it; callers must not retain the
 * returned reference.
 *
 * @param config - Char-overlap params ($k$, $\varepsilon$, $\tau$, `maxDistance`).
 * @param vocabSize - Vocabulary size $K$.
 * @param provider - Lazy neighborhood provider. When absent, the strategy
 *   degenerates to pure uniform (usable during initialization).
 */
export const createCharOverlap: StrategyFactory<CharOverlapConfig> = (
	config: CharOverlapConfig,
	vocabSize: number,
	provider?: NeighborhoodProvider,
): NoiseStrategy<CharOverlapConfig> => {
	// Pre-allocated buffer for getLocalDistribution.
	const _dist = new Float32Array(vocabSize);

	// Cached uniform weight: $1 / K$.
	const _uniformWeight = 1 / vocabSize;

	// Cache the provider pointer so closure captures it.
	const _provider = provider ?? null;

	return {
		info: CHAR_OVERLAP_INFO,
		config,

		sampleStep(token: number, beta: number, rng: Rng): number {
			// Draw exactly 2 values to keep the RNG stream path-independent.
			const coin = rng(); // whether to jump
			const draw = rng(); // compound: floor-vs-overlap + token index

			if (coin >= beta) return token;

			// Jump. If no provider → pure uniform.
			if (!_provider) {
				return Math.min(Math.floor(draw * vocabSize), vocabSize - 1);
			}

			const { maxDistance, k, epsilon, tau } = config;
			const resolved = resolveNeighbors(_provider.neighborsOf(token), maxDistance, k, tau);

			// Empty effective list → pure uniform.
			if (!resolved) {
				return Math.min(Math.floor(draw * vocabSize), vocabSize - 1);
			}

			return sampleFromResolved(resolved, draw, epsilon, vocabSize);
		},

		getLocalDistribution(token: number, _beta: number): Float32Array {
			_dist.fill(0);

			if (_provider) {
				const { maxDistance, k, epsilon, tau } = config;
				const resolved = resolveNeighbors(_provider.neighborsOf(token), maxDistance, k, tau);

				if (resolved) {
					fillLocalDistribution(_dist, resolved, epsilon, vocabSize);
				} else {
					// No neighbors → pure uniform.
					const floorPerToken = _uniformWeight * epsilon;
					for (let i = 0; i < vocabSize; i++) {
						_dist[i] = floorPerToken;
					}
				}
			} else {
				_dist.fill(_uniformWeight);
			}

			return _dist;
		},
	};
};
