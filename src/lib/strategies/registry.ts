import type { NoiseStrategy, StrategyFactory, StrategyInfo } from './types.js';
import { createIdentity } from './identity.js';
import { createUniform } from './uniform.js';

/** All known strategies (metadata only — safe to import from UI code). */
export const STRATEGIES: Record<string, StrategyInfo> = {
	identity: {
		id: 'identity',
		label: 'Identity (no noise)',
		description: 'No noise applied. Every token stays as itself at every timestep.',
		stationary: 'point-mass',
	},
	uniform: {
		id: 'uniform',
		label: 'Uniform',
		description: 'Each token independently samples uniformly from the vocab with probability βₜ.',
		stationary: 'uniform',
	},
} as const;

/**
 * Factory map keyed by strategy id.
 * Kept separate from `STRATEGIES` so the picker can import metadata
 * without pulling in every implementation module.
 */
const STRATEGY_FACTORIES: Record<string, StrategyFactory<unknown>> = {
	identity: createIdentity as StrategyFactory<unknown>,
	uniform: createUniform as StrategyFactory<unknown>,
};

/**
 * Get a strategy instance by id.
 *
 * @param id - The strategy id (must be a key in `STRATEGIES`).
 * @param config - Strategy-specific configuration object.
 * @param vocabSize - Vocabulary size $K$ from the active tokenizer.
 * @returns A configured `NoiseStrategy` instance.
 */
export function getStrategy(
	id: string,
	config: unknown,
	vocabSize: number,
): NoiseStrategy<unknown> {
	const factory = STRATEGY_FACTORIES[id];
	if (!factory) {
		throw new Error(`Unknown strategy "${id}". Known: ${Object.keys(STRATEGIES).join(', ')}`);
	}
	return factory(config, vocabSize);
}
