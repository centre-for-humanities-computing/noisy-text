import type { NoiseStrategy, StrategyFactory, StrategyInfo } from './types.js';
import { createAbsorbing } from './absorbing.js';
import { createIdentity } from './identity.js';
import { createLexical } from './lexical.js';
import { createUniform } from './uniform.js';
import type { LexicalNeighborTable } from './lexical-neighbors.js';

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
	absorbing: {
		id: 'absorbing',
		label: 'Absorbing (mask)',
		description:
			'Each non-mask token becomes [MASK] with probability βₜ. Once masked, stays masked.',
		stationary: 'point-mass',
	},
	lexical: {
		id: 'lexical',
		label: 'Lexical (edit distance)',
		description: 'Tokens transition to visually-similar tokens based on string edit distance, mixed with uniform noise.',
		stationary: 'data-dependent',
	},
} as const;

/**
 * Factory map keyed by strategy id.
 * Kept separate from `STRATEGIES` so the picker can import metadata
 * without pulling in every implementation module.
 */
const STRATEGY_FACTORIES: Record<string, StrategyFactory<unknown>> = {
	absorbing: createAbsorbing as StrategyFactory<unknown>,
	identity: createIdentity as StrategyFactory<unknown>,
	lexical: createLexical as StrategyFactory<unknown>,
	uniform: createUniform as StrategyFactory<unknown>,
};

/**
 * Build the strategy config object for a given id and vocab size.
 *
 * The `absorbing` strategy needs `maskTokenId` (a reserved sentinel equal
 * to `vocabSize`, one past the real vocabulary). The `lexical` strategy
 * needs only its lightweight params — the neighbor table is loaded
 * independently inside the worker.
 *
 * Every other strategy takes an empty config. Keeping this in one place
 * ensures the store and the trajectory request agree on the exact config
 * (and thus the cache key).
 *
 * @param id - The strategy id (must be a key in `STRATEGIES`).
 * @param vocabSize - Vocabulary size $K$ from the active tokenizer.
 * @param _extra - Optional extra params (e.g. lexical settings from store).
 * @returns The strategy config object, JSON-serializable.
 */
export function strategyConfigFor(id: string, vocabSize: number, _extra?: Record<string, unknown>): unknown {
	if (id === 'absorbing') {
		return { maskTokenId: vocabSize };
	}
	if (id === 'lexical') {
		// Defaults; overridden by _extra when called from +page.svelte.
		return {
			maxDistance: _extra?.maxDistance ?? 2,
			k: _extra?.k ?? 50,
			epsilon: _extra?.epsilon ?? 0.01,
			tau: _extra?.tau ?? 1.0,
		};
	}
	return {};
}

/**
 * Get a strategy instance by id.
 *
 * @param id - The strategy id (must be a key in `STRATEGIES`).
 * @param config - Strategy-specific configuration object.
 * @param vocabSize - Vocabulary size $K$ from the active tokenizer.
 * @param table - Optional precomputed lexical neighbor table.
 * @returns A configured `NoiseStrategy` instance.
 */
export function getStrategy(
	id: string,
	config: unknown,
	vocabSize: number,
	table?: LexicalNeighborTable,
): NoiseStrategy<unknown> {
	const factory = STRATEGY_FACTORIES[id];
	if (!factory) {
		throw new Error(`Unknown strategy "${id}". Known: ${Object.keys(STRATEGIES).join(', ')}`);
	}
	return factory(config, vocabSize, table);
}
