import type { Trajectory, TrajectoryDeps, TrajectoryProgress } from './types.js';
import { MAX_CELLS } from './types.js';

/**
 * Compute the full coupled trajectory $x_0, x_1, \ldots, x_T$.
 *
 * ## RNG draw order contract
 *
 * The RNG is drawn in a fixed order: outer loop over $t \in [0, T)$,
 * inner loop over position $i \in [0, L)$. Exactly one `sampleStep` call
 * per $(t, i)$ cell. Changing this order changes every trajectory for a
 * given seed — do not reorder without updating the contract.
 *
 * ## Coupling
 *
 * Each $x_{t+1}[i]$ is sampled from $Q_t(\cdot \mid x_t[i])$ where
 * $Q_t$ is parameterized by $\beta_t = \texttt{schedule.beta}(t)$.
 * This is a coupled random walk, NOT independent sampling from
 * $\bar{Q}_t e_{x_0}$.
 *
 * @param inputIds - The initial token sequence $x_0$, length $L$.
 * @param deps - Resolved strategy, schedule, and RNG.
 * @param onProgress - Optional callback for progress reporting.
 * @returns The computed trajectory.
 * @throws If $(T+1) \times L$ exceeds `MAX_CELLS`.
 */
export function computeTrajectory(
	inputIds: Int32Array,
	deps: TrajectoryDeps,
	onProgress?: (progress: TrajectoryProgress) => void,
): Trajectory {
	const { strategy, schedule, rng } = deps;
	const L = inputIds.length;
	const T = schedule.T;

	const totalCells = (T + 1) * L;
	if (totalCells > MAX_CELLS) {
		throw new Error(
			`Trajectory too large: (T+1) × L = ${T + 1} × ${L} = ${totalCells} cells ` +
				`exceeds MAX_CELLS = ${MAX_CELLS}. Reduce T or input length.`,
		);
	}

	const rows = new Int32Array(totalCells);

	// Row 0 is $x_0$.
	rows.set(inputIds);

	// Progress throttling: report at most every 5% of T.
	const progressInterval = Math.max(1, Math.floor(T / 20));

	for (let t = 0; t < T; t++) {
		const beta = schedule.beta(t);
		const srcRow = t * L;
		const dstRow = (t + 1) * L;

		for (let i = 0; i < L; i++) {
			// $x_{t+1}[i] \sim Q_t(\cdot \mid x_t[i])$
			rows[dstRow + i] = strategy.sampleStep(rows[srcRow + i]!, beta, rng);
		}

		if (onProgress && t % progressInterval === 0) {
			onProgress({ step: t + 1, total: T });
		}
	}

	// Final progress report.
	if (onProgress) {
		onProgress({ step: T, total: T });
	}

	return {
		rows,
		T,
		length: L,
		seed: 0, // filled in by caller if needed
		tokensAt(t: number): Int32Array {
			return rows.subarray(t * L, (t + 1) * L);
		},
	};
}
