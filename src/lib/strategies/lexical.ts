import type { NoiseStrategy, Rng, StrategyFactory } from './types.js';
import type { LexicalNeighborTable } from './lexical-neighbors.js';

/**
 * Configuration for the lexical strategy.
 *
 * At each step, a token $x$ stays with probability $1-\beta_t$, or jumps
 * with probability $\beta_t$ to a destination $y$ drawn from:
 *
 * $$P(y \mid x) = (1 - \varepsilon) \cdot \mathrm{lex}(y \mid x) + \varepsilon / K$$
 *
 * where $\mathrm{lex}(y \mid x)$ is a softmax over negative edit distances
 * to $x$'s precomputed top-$k$ neighbor list $N(x)$:
 *
 * $$\mathrm{lex}(y \mid x) \propto \begin{cases}
 *   \exp(-d(x, y) / \tau) & y \in N(x) \\
 *   0 & \text{otherwise}
 * \end{cases}$$
 *
 * If $N(x) = \varnothing$ the lexical term vanishes and $P(y \mid x) = 1/K$
 * (pure uniform). The ergodicity floor $\varepsilon$ guarantees irreducibility
 * regardless of the neighbor table quality.
 *
 * The neighbor table (CSR layout) is passed at construction time, *not*
 * embedded in `config`. `config` carries only the lightweight params that
 * go into the serialized `strategyConfig` (and thus the cache key).
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
 * @param table - Precomputed CSR neighbor table (CSR layout). When absent,
 *   the strategy degenerates to pure uniform (usable during table loading).
 */
export const createLexical: StrategyFactory<LexicalConfig> = (
	config: LexicalConfig,
	vocabSize: number,
	table?: LexicalNeighborTable,
): NoiseStrategy<LexicalConfig> => {
	const { epsilon } = config;
	// tau, maxDistance, k: consumed at table-build time; captured in config
	// for serialization / cache-key correctness.
	void config.tau;
	void config.maxDistance;
	void config.k;

	// Pre-allocated buffer for getLocalDistribution.
	const _dist = new Float32Array(vocabSize);

	// Cached uniform weight: $1 / K$.
	const _uniformWeight = 1 / vocabSize;

	// Cache the table pointer so closure captures it.
	const _table = table ?? null;

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

			// Jump. If no table or no neighbors → pure uniform.
			if (!_table) {
				const idx = Math.min(Math.floor(draw * vocabSize), vocabSize - 1);
				return idx;
			}

			const start = _table.offsets[token]!;
			const end = _table.offsets[token + 1]!;

			// Empty neighbor list: fall back to uniform.
			if (start >= end) {
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

			// Lexical: CDF binary search over CSR weights.
			// $v \in [0, 1)$ maps to the weight CDF.
			const v = (draw - epsilon) / (1 - epsilon);
			const count = end - start;
			// Linear scan for small lists (typical for $k \le 50$).
			let sum = 0;
			for (let i = 0; i < count; i++) {
				sum += _table.weights[start + i]!;
				if (v < sum) {
					return _table.neighborIds[start + i]!;
				}
			}
			// Floating-point rounding: fall back to last entry.
			return _table.neighborIds[end - 1]!;
		},

		getLocalDistribution(token: number, _beta: number): Float32Array {
			// Build the jump distribution $P(y \mid x)$ (without stay prob).
			// The local distribution shown to the user excludes the $\beta$
			// stay-vs-jump gate.
			_dist.fill(0);

			if (_table) {
				const start = _table.offsets[token]!;
				const end = _table.offsets[token + 1]!;
				const lexMass = 1 - epsilon;

				for (let i = start; i < end; i++) {
					_dist[_table.neighborIds[i]!] = lexMass * _table.weights[i]!;
				}

				// Add uniform floor.
				const floorPerToken = _uniformWeight * epsilon;
				for (let i = 0; i < vocabSize; i++) {
					_dist[i]! += floorPerToken;
				}
			} else {
				// No table: pure uniform distribution.
				_dist.fill(_uniformWeight);
			}

			return _dist;
		},
	};
};