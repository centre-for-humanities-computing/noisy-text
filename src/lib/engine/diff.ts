/**
 * Diff primitives for comparing trajectory rows against $x_0$.
 *
 * These are pure functions — no imports from stores, workers, or components.
 */

import type { Trajectory } from './types.js';

/**
 * Count the number of positions where $x_t$ differs from $x_0$.
 *
 * @param x0 - The original token sequence $x_0$, length $L$.
 * @param xt - The noised tokens at timestep $t$, length $L$.
 * @returns Number of changed positions.
 */
export function countChanged(x0: Int32Array, xt: Int32Array): number {
	if (x0.length !== xt.length) {
		throw new Error(`Length mismatch: x0 has ${x0.length} tokens, xt has ${xt.length}`);
	}

	let count = 0;
	for (let i = 0; i < x0.length; i++) {
		if (x0[i] !== xt[i]) count++;
	}
	return count;
}

/**
 * Build a boolean mask indicating which positions differ from $x_0$.
 *
 * @param x0 - The original token sequence $x_0$, length $L$.
 * @param xt - The noised tokens at timestep $t$, length $L$.
 * @param out - Optional reusable output buffer. If provided, it must have
 *   length $\ge L$ and will be overwritten.
 * @returns A `Uint8Array` of length $L$ where `1` means changed.
 */
export function changedMask(x0: Int32Array, xt: Int32Array, out?: Uint8Array): Uint8Array {
	if (x0.length !== xt.length) {
		throw new Error(`Length mismatch: x0 has ${x0.length} tokens, xt has ${xt.length}`);
	}

	const L = x0.length;
	const mask = out ?? new Uint8Array(L);
	for (let i = 0; i < L; i++) {
		mask[i] = x0[i] !== xt[i] ? 1 : 0;
	}
	return mask;
}

/**
 * Compute per-position recency of change at timestep $t$.
 *
 * For each position $i$, scans backward from $t$ to find the most recent
 * step where the token changed. Recency is $1 - \text{stepsAgo} / W$,
 * clamped to $[0, 1]$, where $W$ is the taper window. A position that
 * changed at the current step has recency $1$; a position unchanged
 * within the window has recency $0$.
 *
 * At $t = 0$ there is no previous step, so all positions have recency $0$.
 *
 * @param traj - The trajectory.
 * @param t - Current timestep $t \in [0, T]$.
 * @param window - Number of steps over which recency fades (must be $\ge 1$).
 * @param out - Optional reusable output buffer. If provided, it must have
 *   length $\ge L$ and will be overwritten.
 * @returns A `Float32Array` of length $L$ with recency in $[0, 1]$.
 */
export function recencyAt(
	traj: Trajectory,
	t: number,
	window: number,
	out?: Float32Array,
): Float32Array {
	const L = traj.length;
	const recency = out ?? new Float32Array(L);

	if (t === 0) {
		recency.fill(0);
		return recency;
	}

	const start = Math.max(1, t - window + 1);
	for (let i = 0; i < L; i++) {
		let found = false;
		for (let s = t; s >= start; s--) {
			if (traj.tokensAt(s)[i] !== traj.tokensAt(s - 1)[i]) {
				const stepsAgo = t - s;
				recency[i] = Math.max(0, 1 - stepsAgo / window);
				found = true;
				break;
			}
		}
		if (!found) {
			recency[i] = 0;
		}
	}
	return recency;
}
