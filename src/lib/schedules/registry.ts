import type { Schedule, ScheduleFactory, ScheduleInfo } from './types.js';
import { createLinear } from './linear.js';
import { createCosine } from './cosine.js';

/** All known schedules (metadata only — safe to import from UI code). */
export const SCHEDULES: Record<string, ScheduleInfo> = {
	linear: {
		id: 'linear',
		label: 'Linear',
		description: 'Noise rate increases linearly from start to end.',
	},
	cosine: {
		id: 'cosine',
		label: 'Cosine',
		description: 'Cosine schedule — preserves signal early, collapses near the end.',
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
};

/**
 * Get a schedule instance by id.
 *
 * @param id - The schedule id (must be a key in `SCHEDULES`).
 * @param config - Schedule-specific configuration object.
 * @param T - Total number of timesteps.
 * @returns A configured `Schedule` instance.
 */
export function getSchedule(id: string, config: unknown, T: number): Schedule<unknown> {
	const factory = SCHEDULE_FACTORIES[id];
	if (!factory) {
		throw new Error(`Unknown schedule "${id}". Known: ${Object.keys(SCHEDULES).join(', ')}`);
	}
	return factory(config, T);
}
