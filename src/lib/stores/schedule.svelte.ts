import { getSchedule, type Schedule, type ScheduleInfo } from '$lib/schedules/index.js';

/**
 * Reactive schedule store.
 *
 * Manages the currently selected schedule id, total timesteps $T$,
 * and the instantiated `Schedule` object. $T$ lives here for now;
 * it will migrate to shared state when the trajectory engine lands.
 */
class ScheduleStore {
	currentId: string = $state('linear');
	T: number = $state(300);
	/** Rate multiplier $\lambda$ applied to any schedule's $\beta_t$. */
	multiplier: number = $state(1);
	instance: Schedule<unknown> | null = $state(null);

	/** Current schedule config, assembled from the per-schedule knobs. */
	get config(): Record<string, unknown> {
		return { multiplier: this.multiplier };
	}

	/**
	 * Select and instantiate a schedule.
	 *
	 * @param id - Schedule id from the registry.
	 */
	selectSchedule(id: string): void {
		this.currentId = id;
		this.instance = getSchedule(id, this.config, this.T);
	}

	/**
	 * Update $T$ and re-instantiate the current schedule.
	 *
	 * @param n - New total timestep count.
	 */
	setT(n: number): void {
		this.T = n;
		this.instance = getSchedule(this.currentId, this.config, this.T);
	}

	/**
	 * Update the rate multiplier $\lambda$ and re-instantiate.
	 *
	 * @param lambda - New multiplier ($> 0$; 1 means unscaled).
	 */
	setMultiplier(lambda: number): void {
		this.multiplier = lambda;
		this.instance = getSchedule(this.currentId, this.config, this.T);
	}

	/** Current schedule metadata, or null if not instantiated. */
	get info(): ScheduleInfo | null {
		return this.instance?.info ?? null;
	}
}

/** Singleton schedule store. */
export const scheduleStore = new ScheduleStore();
