import type { MetricId } from './types.js';

/**
 * Registry of distance metrics over (preprocessed) embedding vectors.
 */
export const METRICS: Record<MetricId, { id: MetricId; label: string; description: string }> = {
	cosine: {
		id: 'cosine',
		label: 'Cosine',
		description: 'Angular distance $1 - \\cos(a, b)$; scale-invariant.',
	},
	l2: {
		id: 'l2',
		label: 'L2',
		description: 'Euclidean distance $\\lVert a - b \\rVert_2$.',
	},
};

/**
 * Distance between two vectors under the given metric.
 *
 * - `cosine`: $1 - \frac{a \cdot b}{\lVert a \rVert\, \lVert b \rVert}$
 *   (0 for parallel vectors; 1 for orthogonal; a zero vector yields 1).
 * - `l2`: $\lVert a - b \rVert_2$.
 *
 * Both vectors must have the same length (the shorter is used).
 */
export function metricDistance(a: Float32Array, b: Float32Array, id: MetricId): number {
	const n = Math.min(a.length, b.length);
	if (id === 'l2') {
		let sum = 0;
		for (let i = 0; i < n; i++) {
			const d = a[i]! - b[i]!;
			sum += d * d;
		}
		return Math.sqrt(sum);
	}
	// cosine
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < n; i++) {
		const x = a[i]!;
		const y = b[i]!;
		dot += x * y;
		na += x * x;
		nb += y * y;
	}
	if (na === 0 || nb === 0) return 1;
	return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb));
}
