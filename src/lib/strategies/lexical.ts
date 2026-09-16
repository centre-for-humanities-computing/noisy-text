import type { NoiseStrategy, Rng, StrategyFactory } from './types.js';
import type { NeighborhoodProvider } from './neighborhood.js';
import { fillLocalDistribution, resolveNeighbors, sampleFromResolved } from './neighbor-softmax.js';

/**
 * Configuration for the lexical strategy.
 *
 * At each step, a token $x$ stays with probability $1-\beta_t$, or jumps
 * with probability $\beta_t$ to a destination $y$ drawn from:
 *
 * $$P(y \mid x) = (1 - \varepsilon) \cdot \mathrm{lex}(y \mid x) + \varepsilon / K$$
 *
 * where $\mathrm{lex}(y \mid x)$ is a softmax over negative edit distances
 * to $x$'s neighbor list $N(x)$ (all neighbors within $R_{\max}$, filtered
 * to $\le$ `maxDistance` and truncated to top-$k$):
 *
 * $$\mathrm{lex}(y \mid x) \propto \begin{cases}
 *   \exp(-d(x, y) / \tau) & y \in N(x),\ d(x,y) \le \text{maxDistance} \\
 *   0 & \text{otherwise}
 * \end{cases}$$
 *
 * If $N(x) = \varnothing$ the lexical term vanishes and $P(y \mid x) = 1/K$
 * (pure uniform). The ergodicity floor $\varepsilon$ guarantees irreducibility
 * regardless of the neighbor table quality.
 *
 * All parameters ($k$, `maxDistance`, $\tau$, $\varepsilon$) are applied at
 * **read time** from `config`. The `NeighborhoodProvider` stores only raw
 * distances out to a fixed ceiling $R_{\max}$, so changing any of these
 * four parameters never triggers a recompute.
 */
export interface LexicalConfig {
	/** Maximum edit distance for neighbor inclusion (radius). */
	maxDistance: number;
	/** Maximum number of neighbors per token (list truncation). */
	k: number;
	/** Ergodicity floor $\varepsilon \in [0, 1]$. */
	epsilon: number;
	/** Softmax temperature $\tau$. */
	tau: number;
}

const LEXICAL_INFO = {
	id: 'lexical',
	label: 'Lexical (edit distance)',
	description:
		'Tokens transition to visually-similar tokens based on string edit distance, mixed with uniform noise.',
	stationary: 'data-dependent',
	plainName: 'Drift by spelling',
	gloss:
		'Tokens morph into similarly-spelled tokens, e.g. "Thus" -> "This", "dog" -> "log" — like typos that accumulate over time.',
	tooltip: {
		text: 'At each step, a token either stays the same or jumps to a spelling-similar token. Similarity is measured by Levenshtein edit distance: how many character insertions, deletions, or substitutions separate two words. A small amount of uniform noise (the ergodicity floor $\\varepsilon$) ensures the process can eventually reach any token.',
		math: 'P(y \\mid x) = (1-\\varepsilon)\\,\\mathrm{lex}(y\\mid x) + \\frac{\\varepsilon}{K},\\quad \\mathrm{lex}(y\\mid x) \\propto \\exp(-d(x,y)/\\tau)',
	},
} as const;

/**
 * Filter and softmax neighbors at read time.
 *
 * Delegates to the shared `resolveNeighbors` helper.
 */
const _resolveNeighbors = resolveNeighbors;

/**
 * Create a lexical strategy.
 *
 * `sampleStep` draws exactly 2 rng values per call so the RNG stream is
 * path-independent — this is documented in `engine/README.md`.
 *
 * `getLocalDistribution` returns a reused `Float32Array` buffer of length
 * `vocabSize`. Each call overwrites it; callers must not retain the
 * returned reference.
 *
 * @param config - Lexical params ($k$, $\varepsilon$, $\tau$, `maxDistance`).
 * @param vocabSize - Vocabulary size $K$.
 * @param provider - Lazy neighborhood provider. When absent, the strategy
 *   degenerates to pure uniform (usable during initialization).
 */
export const createLexical: StrategyFactory<LexicalConfig> = (
	config: LexicalConfig,
	vocabSize: number,
	provider?: NeighborhoodProvider,
): NoiseStrategy<LexicalConfig> => {
	// Pre-allocated buffer for getLocalDistribution.
	const _dist = new Float32Array(vocabSize);

	// Cached uniform weight: $1 / K$.
	const _uniformWeight = 1 / vocabSize;

	// Cache the provider pointer so closure captures it.
	const _provider = provider ?? null;

	return {
		info: LEXICAL_INFO,
		config,

		sampleStep(token: number, beta: number, rng: Rng): number {
			// Draw exactly 2 values to keep the RNG stream path-independent.
			const coin = rng(); // whether to jump
			const draw = rng(); // compound: floor-vs-lexical + token index

			if (coin >= beta) return token;

			// Jump. If no provider → pure uniform.
			if (!_provider) {
				return Math.min(Math.floor(draw * vocabSize), vocabSize - 1);
			}

			const { maxDistance, k, epsilon, tau } = config;
			const resolved = _resolveNeighbors(_provider.neighborsOf(token), maxDistance, k, tau);

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
				const resolved = _resolveNeighbors(_provider.neighborsOf(token), maxDistance, k, tau);

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
