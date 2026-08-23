/**
 * Engine types for trajectory computation and caching.
 *
 * A trajectory is the full coupled random walk $x_0, x_1, \ldots, x_T$
 * over a token sequence of length $L$. It is stored as a dense row-major
 * `Int32Array` of $(T+1) \times L$ cells.
 */

/**
 * Specification for computing a trajectory.
 * All fields are required; the engine does not resolve defaults.
 */
export interface TrajectorySpec {
	/** The initial token sequence $x_0$, length $L$. */
	inputIds: Int32Array;
	/** Strategy id (kebab-case). */
	strategyId: string;
	/** Strategy config object. */
	strategyConfig: unknown;
	/** Schedule id (kebab-case). */
	scheduleId: string;
	/** Schedule config object. */
	scheduleConfig: unknown;
	/** Number of noise steps $T$. */
	T: number;
	/** Vocabulary size $K$. */
	vocabSize: number;
	/** Random seed for reproducibility. */
	seed: number;
	/** Tokenizer id (kebab-case). Used by strategies that need tokenizer context
	 *  (e.g. lexical for loading the neighbor table from IndexedDB). */
	tokenizerId: string;
}

/**
 * Resolved dependencies needed to compute a trajectory.
 * The engine receives already-constructed strategy and schedule instances.
 */
export interface TrajectoryDeps {
	strategy: import('../strategies/types.js').NoiseStrategy;
	schedule: import('../schedules/types.js').Schedule;
	rng: import('../strategies/types.js').Rng;
}

/**
 * A computed trajectory: the full sequence of token arrays
 * $x_0, x_1, \ldots, x_T$ stored as a dense row-major `Int32Array`.
 */
export interface Trajectory {
	/** Dense row-major buffer of $(T+1) \times L$ token ids. */
	readonly rows: Int32Array;
	/** Number of noise steps. */
	readonly T: number;
	/** Sequence length $L$. */
	readonly length: number;
	/** The seed used to generate this trajectory. */
	readonly seed: number;

	/**
	 * Return a subarray view of the token ids at step $t$.
	 * Shares the underlying buffer — no copy.
	 */
	tokensAt(t: number): Int32Array;
}

/**
 * Progress callback for long-running trajectory computations.
 */
export interface TrajectoryProgress {
	/** Current step (0-based, $0 \le \text{step} < T$). */
	step: number;
	/** Total number of steps $T$. */
	total: number;
}

/**
 * Maximum total cells $(T+1) \times L$ before the engine refuses to
 * allocate. At ~4 bytes per cell this is ~32 MB.
 */
export const MAX_CELLS = 8_000_000;
