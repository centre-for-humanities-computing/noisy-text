/**
 * Diff primitives for comparing trajectory rows against $x_0$.
 *
 * These are pure functions — no imports from stores, workers, or components.
 */

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
