/**
 * Shared softmax + ergodicity-floor machinery for neighborhood-based
 * noise strategies (lexical, char-overlap, etc.).
 *
 * Strategies that use a `NeighborhoodProvider` share the same read-time
 * pipeline: filter neighbors to `maxDistance` / top-$k$, compute softmax
 * weights over $-d/\tau$, then sample via inverse-CDF with an ergodicity
 * floor $\varepsilon$.
 */

/** A resolved neighbor entry with its softmax weight. */
export interface ResolvedNeighbors {
	entries: { id: number; dist: number }[];
	weights: Float32Array;
}

/**
 * Filter and softmax neighbors at read time.
 *
 * Given the raw neighbor list (all within $R_{\max}$, sorted by distance),
 * filter to $d \le$ `maxDistance` and truncate to top-$k$, then compute
 * softmax weights $w_m = \exp(-d_m / \tau) / \sum \exp(-d_m / \tau)$.
 *
 * Returns `null` if the effective list is empty.
 */
export function resolveNeighbors(
	allNeighbors: readonly { id: number; dist: number }[],
	maxDistance: number,
	k: number,
	tau: number,
): ResolvedNeighbors | null {
	const entries: { id: number; dist: number }[] = [];
	for (let i = 0; i < allNeighbors.length && entries.length < k; i++) {
		const n = allNeighbors[i]!;
		if (n.dist <= maxDistance) {
			entries.push(n);
		}
	}
	if (entries.length === 0) return null;

	// Softmax: $w_m = \exp(-d_m / \tau)$, normalized.
	const logits = entries.map((n) => -n.dist / tau);
	const maxLogit = Math.max(...logits);
	let sumExp = 0;
	for (const l of logits) sumExp += Math.exp(l - maxLogit);

	const weights = new Float32Array(entries.length);
	for (let i = 0; i < entries.length; i++) {
		weights[i] = Math.exp(logits[i]! - maxLogit) / sumExp;
	}
	return { entries, weights };
}

/**
 * Sample a token from resolved neighbors via inverse-CDF, with an
 * ergodicity floor $\varepsilon$.
 *
 * @param resolved - Resolved neighbor entries and softmax weights.
 * @param draw - Uniform random value in $[0, 1)$ (the second rng draw).
 * @param epsilon - Ergodicity floor $\varepsilon \in [0, 1]$.
 * @param vocabSize - Vocabulary size $K$.
 * @returns The sampled token id.
 */
export function sampleFromResolved(
	resolved: ResolvedNeighbors,
	draw: number,
	epsilon: number,
	vocabSize: number,
): number {
	// Uniform floor.
	if (draw < epsilon) {
		return Math.min(Math.floor((draw / epsilon) * vocabSize), vocabSize - 1);
	}

	// Inverse-CDF over softmax weights.
	const v = (draw - epsilon) / (1 - epsilon);
	let cum = 0;
	for (let i = 0; i < resolved.entries.length; i++) {
		cum += resolved.weights[i]!;
		if (v < cum) return resolved.entries[i]!.id;
	}
	return resolved.entries[resolved.entries.length - 1]!.id;
}

/**
 * Fill a pre-allocated distribution array with the jump distribution
 * for a token: $(1-\varepsilon)$ times the softmax weights at neighbor
 * positions, plus $\varepsilon/K$ uniform floor everywhere.
 *
 * The caller must zero `dist` before calling. The uniform floor is
 * added to every position.
 *
 * @param dist - Pre-allocated `Float32Array` of length `vocabSize`.
 * @param resolved - Resolved neighbor entries and softmax weights.
 * @param epsilon - Ergodicity floor $\varepsilon \in [0, 1]$.
 * @param vocabSize - Vocabulary size $K$.
 * @returns The same `dist` array (for chaining).
 */
export function fillLocalDistribution(
	dist: Float32Array,
	resolved: ResolvedNeighbors,
	epsilon: number,
	vocabSize: number,
): Float32Array {
	const lexMass = 1 - epsilon;
	for (let i = 0; i < resolved.entries.length; i++) {
		dist[resolved.entries[i]!.id] = lexMass * resolved.weights[i]!;
	}

	// Add uniform floor.
	const floorPerToken = (1 / vocabSize) * epsilon;
	for (let i = 0; i < vocabSize; i++) {
		dist[i]! += floorPerToken;
	}

	return dist;
}
