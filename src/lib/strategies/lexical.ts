import type { NoiseStrategy, Rng, StrategyFactory } from './types.js';
import type { NeighborhoodProvider } from './neighborhood.js';

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
	description: 'Tokens transition to visually-similar tokens based on string edit distance, mixed with uniform noise.',
	stationary: 'data-dependent',
} as const;

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

			if (coin >= beta) {
				// Stay at current token.
				return token;
			}

			// Jump. If no provider → pure uniform.
			if (!_provider) {
				const idx = Math.min(Math.floor(draw * vocabSize), vocabSize - 1);
				return idx;
			}

			// Derive the effective neighbor list at read time.
			const { maxDistance, k, epsilon, tau } = config;
			const allNeighbors = _provider.neighborsOf(token);

			// Filter by maxDistance, truncate to top-k.
			const effective: { id: number; dist: number }[] = [];
			for (let i = 0; i < allNeighbors.length && effective.length < k; i++) {
				const n = allNeighbors[i]!;
				if (n.dist <= maxDistance) {
					effective.push(n);
				}
			}

			// Empty effective list: fall back to uniform.
			if (effective.length === 0) {
				const idx = Math.min(Math.floor(draw * vocabSize), vocabSize - 1);
				return idx;
			}

			// Compound selector: first determine floor vs lexical,
			// then pick the destination within that category.
			if (draw < epsilon) {
				// Uniform floor: scale draw to $[0, K)$.
				const idx = Math.min(Math.floor((draw / epsilon) * vocabSize), vocabSize - 1);
				return idx;
			}

			// Lexical: compute softmax weights from raw distances at read time.
			// $w_m = \exp(-d_m / \tau)$, normalized.
			const logits = effective.map((n) => -n.dist / tau);
			const maxLogit = Math.max(...logits);
			let sumExp = 0;
			for (const l of logits) sumExp += Math.exp(l - maxLogit);

			// CDF binary search over the softmax weights.
			// $v \in [0, 1)$ maps to the weight CDF.
			const v = (draw - epsilon) / (1 - epsilon);
			let cum = 0;
			for (let i = 0; i < effective.length; i++) {
				cum += Math.exp(logits[i]! - maxLogit) / sumExp;
				if (v < cum) {
					return effective[i]!.id;
				}
			}
			// Floating-point rounding: fall back to last entry.
			return effective[effective.length - 1]!.id;
		},

		getLocalDistribution(token: number, _beta: number): Float32Array {
			// Build the jump distribution $P(y \mid x)$ (without stay prob).
			// The local distribution shown to the user excludes the $\beta$
			// stay-vs-jump gate.
			_dist.fill(0);

			if (_provider) {
				const { maxDistance, k, epsilon, tau } = config;
				const allNeighbors = _provider.neighborsOf(token);

				// Filter by maxDistance, truncate to top-k.
				const effective: { id: number; dist: number }[] = [];
				for (let i = 0; i < allNeighbors.length && effective.length < k; i++) {
					const n = allNeighbors[i]!;
					if (n.dist <= maxDistance) {
						effective.push(n);
					}
				}

				if (effective.length > 0) {
					// Softmax weights from raw distances.
					const logits = effective.map((n) => -n.dist / tau);
					const maxLogit = Math.max(...logits);
					let sumExp = 0;
					for (const l of logits) sumExp += Math.exp(l - maxLogit);

					const lexMass = 1 - epsilon;
					for (let i = 0; i < effective.length; i++) {
						const w = Math.exp(logits[i]! - maxLogit) / sumExp;
						_dist[effective[i]!.id] = lexMass * w;
					}
				}

				// Add uniform floor.
				const floorPerToken = _uniformWeight * epsilon;
				for (let i = 0; i < vocabSize; i++) {
					_dist[i]! += floorPerToken;
				}
			} else {
				// No provider: pure uniform distribution.
				_dist.fill(_uniformWeight);
			}

			return _dist;
		},
	};
};