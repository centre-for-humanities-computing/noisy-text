import type { Schedule, ScheduleFactory, ScheduleInfo } from './types.js';
import { createLinear } from './linear.js';
import { createCosine } from './cosine.js';
import { createConstant } from './constant.js';

/** All known schedules (metadata only — safe to import from UI code). */
export const SCHEDULES: Record<string, ScheduleInfo> = {
	linear: {
		id: 'linear',
		label: 'Linear',
		description: 'Noise rate increases linearly from start to end.',
		plainName: 'Steady ramp',
		gloss: 'Noise increases at a constant pace — the same amount of corruption at every step.',
		tooltip: {
			text: 'The linear schedule raises the per-step noise rate $\\beta_t$ at a constant pace from a small starting value to a larger ending value. Every step adds roughly the same amount of new noise. This is the simplest schedule and a good default.',
			math: '\\beta_t = \\beta_{\\min} + (\\beta_{\\max} - \\beta_{\\min}) \\cdot \\frac{t}{T-1}',
		},
	},
	cosine: {
		id: 'cosine',
		label: 'Cosine',
		description: 'Cosine schedule — preserves signal early, collapses near the end.',
		plainName: 'Gentle then sudden',
		gloss:
			'Noise stays low at first, then accelerates — the text holds on before dissolving quickly.',
		tooltip: {
			text: 'The cosine schedule (Nichol & Dhariwal, 2021) preserves most of the original signal through the early steps, then collapses rapidly near the end. This creates a dramatic effect: the text appears stable for a while, then suddenly disintegrates.',
			math: '\\bar\\alpha_t = \\frac{f(t)}{f(0)},\\quad f(t) = \\cos^2\\!\\left(\\frac{t/T + s}{1+s} \\cdot \\frac{\\pi}{2}\\right)',
		},
	},
	constant: {
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
	},
} as const;

/**
 * Factory map keyed by schedule id.
 * Kept separate from `SCHEDULES` so the picker can import metadata
 * without pulling in every implementation module.
 */
const SCHEDULE_FACTORIES: Record<string, ScheduleFactory<unknown>> = {
	linear: createLinear as ScheduleFactory<unknown>,
	cosine: createCosine as ScheduleFactory<unknown>,
	constant: createConstant as ScheduleFactory<unknown>,
};

/**
 * Extract the rate multiplier $\lambda$ from a schedule config.
 *
 * The multiplier is a shared knob applied on top of any schedule's own
 * config: the remaining keys are forwarded to the schedule factory.
 */
function extractMultiplier(config: unknown): { multiplier: number; rest: unknown } {
	if (typeof config === 'object' && config !== null && 'multiplier' in config) {
		const { multiplier, ...rest } = config as Record<string, unknown>;
		const lambda = Number(multiplier);
		if (Number.isFinite(lambda) && lambda > 0) {
			return { multiplier: lambda, rest };
		}
	}
	return { multiplier: 1, rest: config };
}

/**
 * Wrap a schedule with a rate multiplier $\lambda$.
 *
 * The scaled per-step rate is
 * $\beta'_t = \mathrm{clip}(\lambda \cdot \beta_t,\ 10^{-12},\ 1)$,
 * and the cumulative survival is recomputed by accumulation —
 * $\bar\alpha'_t = \prod_{s=0}^{t} (1 - \beta'_s)$ — since any closed
 * form for the base schedule is invalid once $\beta$ is scaled.
 */
function withMultiplier(base: Schedule<unknown>, lambda: number): Schedule<unknown> {
	const T = base.T;
	const betas = new Float32Array(T);
	const alphaBars = new Float32Array(T);
	let alphaBar = 1;
	for (let t = 0; t < T; t++) {
		// $\beta'_t = \mathrm{clip}(\lambda \beta_t, 10^{-12}, 1)$
		betas[t] = Math.min(Math.max(lambda * base.beta(t), 1e-12), 1);
		alphaBar *= 1 - betas[t]!;
		alphaBars[t] = alphaBar;
	}

	return {
		info: base.info,
		config: { ...(base.config as Record<string, unknown>), multiplier: lambda },
		T,

		beta(t: number): number {
			return betas[Math.min(t, T - 1)]!;
		},

		cumulative(t: number): number {
			return alphaBars[Math.min(t, T - 1)]!;
		},
	};
}

/**
 * Get a schedule instance by id.
 *
 * @param id - The schedule id (must be a key in `SCHEDULES`).
 * @param config - Schedule-specific configuration object. A `multiplier`
 *   key ($\lambda > 0$, default 1) scales the schedule's $\beta_t$ and is
 *   not forwarded to the schedule factory.
 * @param T - Total number of timesteps.
 * @returns A configured `Schedule` instance.
 */
export function getSchedule(id: string, config: unknown, T: number): Schedule<unknown> {
	const factory = SCHEDULE_FACTORIES[id];
	if (!factory) {
		throw new Error(`Unknown schedule "${id}". Known: ${Object.keys(SCHEDULES).join(', ')}`);
	}
	const { multiplier, rest } = extractMultiplier(config);
	const base = factory(rest, T);
	return multiplier === 1 ? base : withMultiplier(base, multiplier);
}
