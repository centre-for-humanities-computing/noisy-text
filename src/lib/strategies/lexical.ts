import type { NoiseStrategy, StrategyFactory } from './types.js';
import type { NeighborhoodProvider } from './neighborhood.js';
import { ModelDistanceSource } from './distance-source.js';
import { createTokenKernel } from './token-kernel.js';
import { createKernelStrategy } from './kernel-strategy.js';
import { getWeightFamily } from './weight-family.js';
import type { WeightFamilyId } from './weight-family.js';

/**
 * Configuration for the lexical strategy.
 *
 * At each step, a token $x$ stays with probability $1-\beta_t$, or jumps
 * with probability $\beta_t$ to a destination $y$ drawn from:
 *
 * $$P(y \mid x) = (1 - \varepsilon) \cdot \mathrm{lex}(y \mid x) + \varepsilon / K$$
 *
 * where $\mathrm{lex}(y \mid x)$ is a softmax over a weight family
 * applied to edit distances to $x$'s neighbor list $N(x)$ (all neighbors
 * within $R_{\max}$, filtered to $\le$ `maxDistance` and truncated to
 * top-$k$):
 *
 * $$\mathrm{lex}(y \mid x) \propto \begin{cases}
 *   w_\tau(d(x, y)) & y \in N(x),\ d(x,y) \le \text{maxDistance} \\
 *   0 & \text{otherwise}
 * \end{cases}$$
 *
 * The weight family $w_\tau$ is selectable (`family`); the default
 * `exponential` family $w_\tau(d) = \exp(-d/\tau)$ reproduces the
 * original softmax.
 *
 * If $N(x) = \varnothing$ the lexical term vanishes and $P(y \mid x) = 1/K$
 * (pure uniform). The ergodicity floor $\varepsilon$ guarantees irreducibility
 * regardless of the neighbor table quality.
 *
 * The `NeighborhoodProvider` stores only raw distances out to a fixed
 * ceiling $R_{\max}$, so changing $k$, `maxDistance`, $\tau$, $\varepsilon$
 * or `family` never triggers a neighbor recompute — a new kernel is built
 * over the same tables.
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
	/** Weight family for $w_\tau$; defaults to `'exponential'`. */
	family?: WeightFamilyId;
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
 * Create a lexical strategy.
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
 * @param config - Lexical params ($k$, $\varepsilon$, $\tau$, `maxDistance`,
 *   `family`).
 * @param vocabSize - Vocabulary size $K$.
 * @param provider - Lazy neighborhood provider. When absent, the strategy
 *   degenerates to pure uniform (usable during initialization).
 */
export const createLexical: StrategyFactory<LexicalConfig> = (
	config: LexicalConfig,
	vocabSize: number,
	provider?: NeighborhoodProvider,
): NoiseStrategy<LexicalConfig> => {
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

	return createKernelStrategy<LexicalConfig>({
		info: LEXICAL_INFO,
		config,
		vocabSize,
		kernel,
		epsilon: config.epsilon,
	});
};
