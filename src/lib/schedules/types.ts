/**
 * Core types for noise schedules.
 *
 * A schedule maps a timestep $t \in [0, T)$ to a per-step noise rate
 * $\beta_t \in (0, 1)$. The cumulative quantity $\bar\alpha_t$ tracks
 * how much original signal survives after $t$ steps:
 *
 * $$\bar\alpha_t = \prod_{s=0}^{t} (1 - \beta_s)$$
 *
 * The transition matrix at step $t$ is $Q_t = (1 - \beta_t) I + \beta_t R$,
 * where $R$ encodes the strategy's noising direction. Schedules are
 * independent of strategies — any pairing must work.
 */

/** Human-readable metadata for a schedule, used by the picker UI. */
export interface ScheduleInfo {
	/** Unique kebab-case id, e.g. `'linear'`. */
	id: string;
	/** Short display label, e.g. `'Linear'`. */
	label: string;
	/** One-line description shown in the picker or tooltip. */
	description: string;
}

/**
 * A noise schedule parameterized by a config object `Config`.
 *
 * Schedules are pure: they do not import strategies, workers, stores,
 * or tokenizers. The total number of timesteps $T$ is captured at
 * construction time via the factory.
 */
export interface Schedule<Config = unknown> {
	/** Metadata for the picker UI. */
	readonly info: ScheduleInfo;
	/** The config used to create this instance. */
	readonly config: Config;
	/** Total number of timesteps $T$. */
	readonly T: number;

	/**
	 * Per-step noise rate at timestep $t$.
	 *
	 * @param t - The current timestep index (0-based, $0 \le t < T$).
	 * @returns $\beta_t \in (0, 1)$.
	 */
	beta(t: number): number;

	/**
	 * Cumulative survival probability after $t$ steps.
	 *
	 * $\bar\alpha_t = \prod_{s=0}^{t} (1 - \beta_s)$.
	 * When a closed form exists (e.g. cosine), it is used directly.
	 * Otherwise (e.g. linear), the product is accumulated.
	 *
	 * @param t - The current timestep index (0-based, $0 \le t < T$).
	 * @returns $\bar\alpha_t \in [0, 1]$.
	 */
	cumulative(t: number): number;
}

/**
 * A factory that creates a `Schedule` given a config and total timesteps $T$.
 */
export type ScheduleFactory<Config = unknown> = (config: Config, T: number) => Schedule<Config>;
