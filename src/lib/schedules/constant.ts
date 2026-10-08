import type { Schedule, ScheduleFactory } from './types.js';

/**
 * Configuration for the constant schedule.
 *
 * $\beta_t = \beta$ for every timestep — the noise rate never changes.
 */
export interface ConstantConfig {
	/** Fixed per-step noise rate $\beta \in (0, 1)$. */
	beta: number;
}

const CONSTANT_INFO = {
	id: 'constant',
	label: 'Constant',
	description: 'Noise rate is fixed at a constant value for every step.',
	plainName: 'Fixed rate',
	gloss:
		'Noise stays at the same level the whole time — every step corrupts the same fraction of tokens.',
	tooltip: {
		text: 'The constant schedule keeps the per-step noise rate $\\beta_t$ fixed for the whole trajectory. Every step corrupts the same fraction of tokens, so the text decays at a steady exponential pace: after $t$ steps a fraction $(1-\\beta)^{t+1}$ of the original signal survives.',
		math: '\\beta_t = \\beta,\\quad \\bar\\alpha_t = (1-\\beta)^{t+1}',
	},
} as const;

const DEFAULT_CONFIG: ConstantConfig = {
	beta: 0.02,
};

/**
 * Create a constant schedule.
 *
 * $\beta_t = \beta$ for all $t$, and $\bar\alpha_t = (1-\beta)^{t+1}$
 * in closed form.
 */
export const createConstant: ScheduleFactory<ConstantConfig> = (
	config: Partial<ConstantConfig> = {},
	T: number,
): Schedule<ConstantConfig> => {
	const resolved: ConstantConfig = { ...DEFAULT_CONFIG, ...config };

	// $\bar\alpha_t = \prod_{s=0}^{t} (1 - \beta) = (1-\beta)^{t+1}$
	const alphaBars = new Float32Array(T);
	const survival = 1 - resolved.beta;
	for (let t = 0; t < T; t++) {
		alphaBars[t] = survival ** (t + 1);
	}

	return {
		info: CONSTANT_INFO,
		config: resolved,
		T,

		beta(): number {
			return resolved.beta;
		},

		cumulative(t: number): number {
			return alphaBars[Math.min(t, T - 1)]!;
		},
	};
};
