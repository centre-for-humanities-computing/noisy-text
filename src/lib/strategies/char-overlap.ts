import type { NoiseStrategy, StrategyFactory } from './types.js';
import type { NeighborhoodProvider } from './neighborhood.js';
import type { CharOverlapMode } from './char-overlap-model.js';
import { ModelDistanceSource } from './distance-source.js';
import { createTokenKernel } from './token-kernel.js';
import { createKernelStrategy } from './kernel-strategy.js';
import { getWeightFamily } from './weight-family.js';
import type { WeightFamilyId } from './weight-family.js';

/**
 * Configuration for the character-overlap strategy.
 *
 * At each step, a token $x$ stays with probability $1-\beta_t$, or jumps
 * with probability $\beta_t$ to a destination $y$ drawn from:
 *
 * $$P(y \mid x) = (1 - \varepsilon) \cdot \mathrm{overlap}(y \mid x) + \varepsilon / K$$
 *
 * where $\mathrm{overlap}(y \mid x)$ is a softmax over a weight family
 * applied to Jaccard distances to $x$'s neighbor list $N(x)$ (all
 * neighbors within $R_{\max}$, filtered to $\le$ `maxDistance` and
 * truncated to top-$k$):
 *
 * $$\mathrm{overlap}(y \mid x) \propto \begin{cases}
 *   w_\tau(d(x, y)) & y \in N(x),\ d(x,y) \le \text{maxDistance} \\
 *   0 & \text{otherwise}
 * \end{cases}$$
 *
 * where $d(x,y) = 1 - J(C(x), C(y))$ is the Jaccard distance over the
 * character sets (code points) of the raw subword strings. The weight
 * family $w_\tau$ is selectable (`family`); the default `exponential`
 * family $w_\tau(d) = \exp(-d/\tau)$ reproduces the original softmax.
 *
 * If $N(x) = \varnothing$ the overlap term vanishes and $P(y \mid x) = 1/K$
 * (pure uniform). The ergodicity floor $\varepsilon$ guarantees irreducibility
 * regardless of the neighbor table quality.
 *
 * The `NeighborhoodProvider` stores only raw distances out to a fixed
 * ceiling $R_{\max}$, so changing $k$, `maxDistance`, $\tau$, $\varepsilon$
 * or `family` never triggers a neighbor recompute — a new kernel is built
 * over the same tables.
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
	/** Distance mode: `'set'` (distinct chars) or `'multiset'` (count-aware). */
	mode: CharOverlapMode;
	/** Weight family for $w_\tau$; defaults to `'exponential'`. */
	family?: WeightFamilyId;
}

const CHAR_OVERLAP_INFO = {
	id: 'char-overlap',
	label: 'Character overlap (Jaccard)',
	description:
		'Tokens transition to tokens with similar character sets based on Jaccard distance, mixed with uniform noise.',
	stationary: 'data-dependent',
	plainName: 'Drift by shared letters',
	gloss:
		'Tokens morph into tokens that share the same letters, e.g. "cat" -> "act", "dog" -> "god" — like anagrams drifting apart.',
	tooltip: {
		text: 'At each step, a token either stays the same or jumps to a token with a similar set of characters. Similarity is measured by Jaccard distance: how much two tokens\' character sets overlap. Tokens sharing many letters (like "cat" and "act") are close neighbours. A small uniform floor $\\varepsilon$ keeps the process connected.',
		math: 'P(y \\mid x) = (1-\\varepsilon)\\,\\mathrm{overlap}(y\\mid x) + \\frac{\\varepsilon}{K},\\quad d(x,y) = 1 - J\\big(C(x), C(y)\\big)',
	},
} as const;

/**
 * Create a character-overlap strategy.
 *
 * The jump distribution is a `TokenKernel` over the provider's neighbor
 * tables and the selected weight family; the strategy body (the
 * $\beta_t$ coin, the no-table uniform fallback, and the dense
 * `getLocalDistribution` row) is shared `createKernelStrategy`.
 *
 * `sampleStep` draws exactly 2 rng values per call so the RNG stream is
 * path-independent — this is documented in `engine/README.md`.
 *
 * `getLocalDistribution` returns a reused `Float32Array` buffer of length
 * `vocabSize`. Each call overwrites it; callers must not retain the
 * returned reference.
 *
 * @param config - Char-overlap params ($k$, $\varepsilon$, $\tau$,
 *   `maxDistance`, `family`).
 * @param vocabSize - Vocabulary size $K$.
 * @param provider - Lazy neighborhood provider. When absent, the strategy
 *   degenerates to pure uniform (usable during initialization).
 */
export const createCharOverlap: StrategyFactory<CharOverlapConfig> = (
	config: CharOverlapConfig,
	vocabSize: number,
	provider?: NeighborhoodProvider,
): NoiseStrategy<CharOverlapConfig> => {
	const family = getWeightFamily(config.family ?? 'exponential');

	// Kernel over the provider's raw distance tables; `null` → uniform
	// jumps (no table available yet).
	const kernel = provider
		? createTokenKernel(new ModelDistanceSource(provider.model, provider), family, {
				k: config.k,
				maxDistance: config.maxDistance,
				tau: config.tau,
				epsilon: config.epsilon,
				vocabSize,
			})
		: null;

	return createKernelStrategy<CharOverlapConfig>({
		info: CHAR_OVERLAP_INFO,
		config,
		vocabSize,
		kernel,
		epsilon: config.epsilon,
	});
};
