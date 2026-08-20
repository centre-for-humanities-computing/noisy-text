import {
	getStrategy,
	strategyConfigFor,
	type NoiseStrategy,
	type StrategyInfo,
} from '$lib/strategies/index.js';

class StrategyStore {
	currentId: string = $state('identity');
	instance: NoiseStrategy<unknown> | null = $state(null);

	/**
	 * Select and instantiate a strategy.
	 *
	 * @param id - Strategy id from the registry.
	 * @param vocabSize - Vocabulary size $K$ from the active tokenizer.
	 */
	selectStrategy(id: string, vocabSize: number): void {
		this.currentId = id;
		const config = strategyConfigFor(id, vocabSize);
		this.instance = getStrategy(id, config, vocabSize);
	}

	/** Current strategy metadata, or null if not instantiated. */
	get info(): StrategyInfo | null {
		return this.instance?.info ?? null;
	}
}

/** Singleton strategy store. */
export const strategyStore = new StrategyStore();
