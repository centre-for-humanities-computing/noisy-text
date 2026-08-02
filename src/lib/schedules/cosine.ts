import type { Schedule, ScheduleFactory } from './types.js';

/**
 * Configuration for the cosine schedule (no knobs).
 *
 * Uses the Nichol & Dhariwal (2021) cosine schedule with offset $s = 0.008$.
 */
export type CosineConfig = Record<string, never>;

const COSINE_INFO = {
	id: 'cosine',
	label: 'Cosine',
	description: 'Cosine schedule — preserves signal early, collapses near the end.',
} as const;

/** Offset $s$ from Nichol & Dhariwal (2021). */
const S = 0.008;

/**
 * Create a cosine schedule (Nichol & Dhariwal, 2021).
 *
 * Define $f(t) = \cos^2\!\big(\frac{t/T + s}{1 + s} \cdot \frac{\pi}{2}\big)$.
 * Then $\bar\alpha_t = f(t) / f(0)$.
 *
 * $\beta_t = 1 - \bar\alpha_t / \bar\alpha_{t-1}$ for $t > 0$,
 * and $\beta_0 = 1 - \bar\alpha_0$. Values are clipped to $(0, 1)$.
 */
export const createCosine: ScheduleFactory<CosineConfig> = (
	_config: CosineConfig,
	T: number,
): Schedule<CosineConfig> => {
	// Pre-compute beta_t and alpha_bar_t for all t.
	const betas = new Float32Array(T);
	const alphaBars = new Float32Array(T);

	// $f(0) = \cos^2(\frac{s}{1+s} \cdot \frac{\pi}{2})$
	const f0 = Math.cos((S / (1 + S)) * (Math.PI / 2)) ** 2;

	for (let t = 0; t < T; t++) {
		// $f(t) = \cos^2(\frac{t/T + s}{1 + s} \cdot \frac{\pi}{2})$
		const ft = Math.cos(((t / T + S) / (1 + S)) * (Math.PI / 2)) ** 2;
		// $\bar\alpha_t = f(t) / f(0)$
		alphaBars[t] = ft / f0;
	}

	// $\beta_0 = 1 - \bar\alpha_0$, clipped to $[10^{-12}, 1)$
	betas[0] = Math.min(Math.max(1 - alphaBars[0]!, 1e-12), 1);

	for (let t = 1; t < T; t++) {
		// $\beta_t = 1 - \bar\alpha_t / \bar\alpha_{t-1}$, clipped to $[10^{-12}, 1)$
		const ratio = alphaBars[t]! / alphaBars[t - 1]!;
		betas[t] = Math.min(Math.max(1 - ratio, 1e-12), 1);
	}

	return {
		info: COSINE_INFO,
		config: {},
		T,

		beta(t: number): number {
			return betas[t]!;
		},

		cumulative(t: number): number {
			return alphaBars[t]!;
		},
	};
};
