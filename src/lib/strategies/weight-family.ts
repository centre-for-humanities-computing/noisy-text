/**
 * Weight families for distance-based transition kernels $K_\tau$.
 *
 * A weight family is the "where tokens go" half of a distance-based noise
 * strategy: given a neighbor table $N_k(x)$ (the top-$k$ nearest tokens
 * within `maxDistance`, self excluded), each neighbor $y$ at distance
 * $d(x, y)$ gets an unnormalized weight, and the kernel row is the
 * normalized softmax:
 *
 * $$K_\tau(y \mid x) = \frac{w(d(x,y);\, \tau)}{\sum_{z \in N_k(x)} w(d(x,z);\, \tau)}$$
 *
 * The "how much noise" half (the schedule's $\beta_t$ and the ergodicity
 * floor $\varepsilon$) is applied by the strategy around the kernel, never
 * by the family itself.
 *
 * All families share the same limits in $\tau > 0$:
 *
 * - $\tau \to 0$: mass concentrates on the smallest distance in the row
 *   (nearest neighbor).
 * - $\tau \to \infty$: weight ratios tend to $1$, so the row flattens to
 *   the uniform distribution over the neighbor table.
 *
 * The kernel computes rows in log space via `logWeight` for numerical
 * stability; `weight` is the human-facing unnormalized form. `logWeight`
 * is computed directly (not as $\log(\mathrm{weight}(d, \tau))$) so the
 * exponential family reproduces the legacy softmax
 * $w_m = \exp(-d_m/\tau)$ bit-exactly.
 */

/** Selectable weight-family ids for distance-based kernels. */
export type WeightFamilyId = 'exponential' | 'power-law' | 'gaussian';

/** A family of unnormalized kernel weights over distances. */
export interface WeightFamily {
	readonly id: WeightFamilyId;
	readonly label: string;
	/** Unnormalized weight for a neighbor at distance `dist`, temperature `tau > 0`. */
	weight(dist: number, tau: number): number;
	/**
	 * $\log w(d; \tau)$, computed directly rather than through `weight`
	 * so no accuracy is lost to a $\log \circ \exp$ round-trip.
	 */
	logWeight(dist: number, tau: number): number;
}

export const WEIGHT_FAMILIES: Record<WeightFamilyId, WeightFamily> = {
	exponential: {
		id: 'exponential',
		label: 'Exponential',
		// $w(d; \tau) = \exp(-d / \tau)$ — the legacy lexical softmax.
		weight: (dist, tau) => Math.exp(-dist / tau),
		logWeight: (dist, tau) => -dist / tau,
	},
	'power-law': {
		id: 'power-law',
		label: 'Power law',
		// $w(d; \tau) = (1 + d)^{-1/\tau}$ — a *shifted* base rather than
		// the literal $d^{-p}$: it reuses the single temperature $\tau$,
		// stays finite at $d = 0$, and keeps the required limits
		// ($\tau \to 0$ nearest neighbor, $\tau \to \infty$ uniform over
		// the neighbor table).
		weight: (dist, tau) => Math.pow(1 + dist, -1 / tau),
		logWeight: (dist, tau) => -Math.log(1 + dist) / tau,
	},
	gaussian: {
		id: 'gaussian',
		label: 'Gaussian',
		// $w(d; \tau) = \exp(-d^2 / (2\tau^2))$.
		weight: (dist, tau) => Math.exp(-(dist * dist) / (2 * tau * tau)),
		logWeight: (dist, tau) => -(dist * dist) / (2 * tau * tau),
	},
};

/**
 * Look up a weight family by id.
 *
 * @param id - One of the `WeightFamilyId` strings.
 * @returns The matching family.
 * @throws If the id is not a known family.
 */
export function getWeightFamily(id: string): WeightFamily {
	if (!isWeightFamilyId(id)) {
		throw new Error(
			`Unknown weight family "${id}". Known: ${Object.keys(WEIGHT_FAMILIES).join(', ')}`,
		);
	}
	return WEIGHT_FAMILIES[id];
}

/** Type guard for `WeightFamilyId` strings (safe for untrusted config input). */
export function isWeightFamilyId(id: string): id is WeightFamilyId {
	return Object.hasOwn(WEIGHT_FAMILIES, id);
}

/** Smallest positive temperature; floors the $\tau \to 0$ limit at a finite value. */
export const MIN_TAU = 1e-6;

/** Clamp a temperature to the strictly-positive domain (guards $\tau \le 0$ and non-finite). */
export function clampTau(tau: number): number {
	return Number.isFinite(tau) && tau > MIN_TAU ? tau : MIN_TAU;
}
