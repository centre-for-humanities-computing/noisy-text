/**
 * Core types for noise strategies.
 *
 * A noise strategy defines a Markov chain $x_0 \to x_1 \to \ldots \to x_T$
 * over a vocabulary of size $K$. Each step samples $x_{t+1}$ from a
 * categorical distribution conditioned on $x_t$ and the current timestep $t$.
 *
 * The full $K \times K$ transition matrix $Q_t$ is never materialized.
 * Strategies expose only `sampleStep` (coupled walk) and, optionally,
 * `getLocalDistribution` (one row of $Q_t$ for inspection).
 */

/**
 * A uniform pseudo-random number generator returning a value in $[0, 1)$.
 * Injected so engine code never calls `Math.random()` directly.
 * `Math.random` itself satisfies this type for trivial UI use.
 */
export type Rng = () => number;

/**
 * Describes the stationary distribution of the Markov chain induced by
 * repeated application of the strategy at a fixed noise rate.
 *
 * - `'uniform'`: converges to uniform over the vocabulary.
 * - `'point-mass'`: converges to a single token (e.g., a mask token).
 * - `'data-dependent'`: stationary distribution depends on the input
 *   (e.g., lexical strategies with disconnected components).
 * - `'unknown'`: behavior not characterized.
 */
export type StationaryBehavior =
	| 'uniform'
	| 'point-mass'
	| 'data-dependent'
	| 'unknown';

/** Human-readable metadata for a strategy, used by the picker UI. */
export interface StrategyInfo {
	/** Unique kebab-case id, e.g. `'identity'`. */
	id: string;
	/** Short display label, e.g. `'Identity (no noise)'`. */
	label: string;
	/** One-line description shown in the picker or tooltip. */
	description: string;
	/** Stationary-distribution behavior of this strategy. */
	stationary: StationaryBehavior;
}

/**
 * A noise strategy parameterized by a config object `Config`.
 *
 * Strategies are pure: they do not import schedules, workers, stores,
 * or tokenizers. The vocabulary size is captured at construction time
 * via the factory so strategies can pre-allocate buffers.
 */
export interface NoiseStrategy<Config = unknown> {
	/** Metadata for the picker UI. */
	readonly info: StrategyInfo;
	/** The config used to create this instance. */
	readonly config: Config;

	/**
	 * Advance one token one step in the coupled random walk.
	 *
	 * Samples $x_{t+1} \sim Q_t(\cdot \mid x_t)$ where $x_t$ is `token`
	 * and $t$ is the current timestep index (0-based, $0 \le t < T$).
	 *
	 * @param token - The current token id $x_t \in [0, K)$.
	 * @param t - The current timestep index.
	 * @param rng - A uniform RNG in $[0, 1)$.
	 * @returns The next token id $x_{t+1} \in [0, K)$.
	 */
	sampleStep(token: number, t: number, rng: Rng): number;

	/**
	 * Return the local transition distribution for a given token at
	 * timestep $t$ — i.e., one row of $Q_t$.
	 *
	 * Optional. When implemented, returns a `Float32Array` of length
	 * `vocabSize` where entry $j$ is $P(x_{t+1} = j \mid x_t = \text{token})$.
	 *
	 * @param token - The current token id $x_t$.
	 * @param t - The current timestep index.
	 * @returns A probability vector of length `vocabSize`.
	 */
	getLocalDistribution?(token: number, t: number): Float32Array;
}

/**
 * A factory that creates a `NoiseStrategy` given a config and vocabulary size.
 *
 * Factories receive `vocabSize` from the active tokenizer so strategies
 * can size internal buffers without importing tokenizer code.
 */
export type StrategyFactory<Config = unknown> = (
	config: Config,
	vocabSize: number,
) => NoiseStrategy<Config>;
