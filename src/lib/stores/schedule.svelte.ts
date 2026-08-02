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
	T: number = $state(100);
	instance: Schedule<unknown> | null = $state(null);

	/**
	 * Select and instantiate a schedule.
	 *
	 * @param id - Schedule id from the registry.
	 */
	selectSchedule(id: string): void {
		this.currentId = id;
		this.instance = getSchedule(id, {}, this.T);
	}

	/**
	 * Update $T$ and re-instantiate the current schedule.
	 *
	 * @param n - New total timestep count.
	 */
	setT(n: number): void {
		this.T = n;
		this.instance = getSchedule(this.currentId, {}, this.T);
	}

	/** Current schedule metadata, or null if not instantiated. */
	get info(): ScheduleInfo | null {
		return this.instance?.info ?? null;
	}
}

/** Singleton schedule store. */
export const scheduleStore = new ScheduleStore();
