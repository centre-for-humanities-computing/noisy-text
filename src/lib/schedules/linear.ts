import type { Schedule, ScheduleFactory } from './types.js';

/**
 * Configuration for the linear schedule.
 *
 * $\beta_t$ is linearly interpolated from `betaMin` at $t = 0$
 * to `betaMax` at $t = T - 1$.
 */
export interface LinearConfig {
	/** Noise rate at $t = 0$. */
	betaMin: number;
	/** Noise rate at $t = T - 1$. */
	betaMax: number;
}

const LINEAR_INFO = {
	id: 'linear',
	label: 'Linear',
	description: 'Noise rate increases linearly from start to end.',
} as const;

const DEFAULT_CONFIG: LinearConfig = {
	betaMin: 1e-4,
	betaMax: 0.02,
};

/**
 * Create a linear schedule.
 *
 * $\beta_t = \beta_{\min} + (\beta_{\max} - \beta_{\min}) \cdot \frac{t}{T-1}$
 * for $T > 1$, and $\beta_0 = \beta_{\min}$ when $T = 1$.
 *
 * $\bar\alpha_t$ is computed by accumulating the product of $(1 - \beta_s)$
 * — there is no closed form for the linear schedule.
 */
export const createLinear: ScheduleFactory<LinearConfig> = (
	config: Partial<LinearConfig> = {},
	T: number,
): Schedule<LinearConfig> => {
	const resolved: LinearConfig = { ...DEFAULT_CONFIG, ...config };
	const { betaMin, betaMax } = resolved;

	// Pre-compute beta_t for all t and accumulate alpha_bar_t.
	// Schedule math is cheap — no worker needed.
	const betas = new Float32Array(T);
	const alphaBars = new Float32Array(T);

	if (T === 1) {
		betas[0] = betaMin;
		alphaBars[0] = 1 - betaMin;
	} else {
		const range = betaMax - betaMin;
		const denom = T - 1;
		let alphaBar = 1;
		for (let t = 0; t < T; t++) {
			// $\beta_t = \beta_{\min} + (\beta_{\max} - \beta_{\min}) \cdot t / (T-1)$
			betas[t] = betaMin + range * (t / denom);
			alphaBar *= 1 - betas[t]!;
			alphaBars[t] = alphaBar;
		}
	}

	return {
		info: LINEAR_INFO,
		config: resolved,
		T,

		beta(t: number): number {
			return betas[t]!;
		},

		cumulative(t: number): number {
			return alphaBars[t]!;
		},
	};
};
