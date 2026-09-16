import type { NoiseStrategy, StrategyFactory, StrategyInfo } from './types.js';
import { createAbsorbing } from './absorbing.js';
import { createCharOverlap } from './char-overlap.js';
import { createIdentity } from './identity.js';
import { createLexical } from './lexical.js';
import { createUniform } from './uniform.js';
import type { NeighborhoodProvider } from './neighborhood.js';

/** All known strategies (metadata only — safe to import from UI code). */
export const STRATEGIES: Record<string, StrategyInfo> = {
	identity: {
		id: 'identity',
		label: 'Identity (no noise)',
		description: 'No noise applied. Every token stays as itself at every timestep.',
		stationary: 'point-mass',
		plainName: 'No noise',
		gloss: 'Every token stays exactly as you typed it — a baseline for comparison.',
		tooltip: {
			text: 'The identity strategy applies no noise at all. Every token remains unchanged at every step. This is useful as a baseline: scrub the timeline and confirm that nothing moves.',
			math: 'Q_t = I \\quad \\text{for all } t',
		},
	},
	uniform: {
		id: 'uniform',
		label: 'Uniform',
		description: 'Each token independently samples uniformly from the vocab with probability βₜ.',
		stationary: 'uniform',
		plainName: 'Random swap',
		gloss: 'Tokens are randomly replaced by any token in the vocabulary, like static on a radio.',
		tooltip: {
			text: 'At each step, every token has probability $\\beta_t$ of being replaced by a uniformly random token from the entire vocabulary. Over time the text converges to pure noise — every token equally likely.',
			math: 'Q_t = (1-\\beta_t)\\,I + \\frac{\\beta_t}{K}\\,\\mathbf{1}\\mathbf{1}^\\top',
		},
	},
	absorbing: {
		id: 'absorbing',
		label: 'Absorbing (mask)',
		description:
			'Each non-mask token becomes [MASK] with probability βₜ. Once masked, stays masked.',
		stationary: 'point-mass',
		plainName: 'Erase tokens',
		gloss:
			'Tokens gradually turn into blanks, like redacting a classified document one token at a time.',
		tooltip: {
			text: 'At each step, every non-masked token has probability $\\beta_t$ of turning into [MASK]. Once a token is masked, it stays masked forever — the mask state is absorbing. Over time, all words disappear into blanks.',
			math: 'Q_t = (1-\\beta_t)\\,I + \\beta_t\\,\\mathbf{1}\\,e_m^\\top',
		},
	},
	lexical: {
		id: 'lexical',
		label: 'Lexical (edit distance)',
		description:
			'Tokens transition to visually-similar tokens based on string edit distance, mixed with uniform noise.',
		stationary: 'data-dependent',
		plainName: 'Drift by spelling',
		gloss: 'Words morph into similarly-spelled words — like typos that accumulate over time.',
		tooltip: {
			text: 'At each step, a token either stays the same or jumps to a spelling-similar token. Similarity is measured by Levenshtein edit distance: how many character insertions, deletions, or substitutions separate two words. A small amount of uniform noise (the ergodicity floor $\\varepsilon$) ensures the process can eventually reach any token.',
			math: 'P(y \\mid x) = (1-\\varepsilon)\\,\\mathrm{lex}(y\\mid x) + \\frac{\\varepsilon}{K},\\quad \\mathrm{lex}(y\\mid x) \\propto \\exp(-d(x,y)/\\tau)',
		},
	},
	'char-overlap': {
		id: 'char-overlap',
		label: 'Character overlap (Jaccard)',
		description:
			'Tokens transition to tokens with similar character sets based on Jaccard distance, mixed with uniform noise.',
		stationary: 'data-dependent',
		plainName: 'Drift by shared letters',
		gloss: 'Words morph into words that share the same letters — like anagrams drifting apart.',
		tooltip: {
			text: 'At each step, a token either stays the same or jumps to a token with a similar set of characters. Similarity is measured by Jaccard distance: how much two words\' character sets overlap. Words sharing many letters (like "cat" and "act") are close neighbours. A small uniform floor $\\varepsilon$ keeps the process connected.',
			math: 'P(y \\mid x) = (1-\\varepsilon)\\,\\mathrm{overlap}(y\\mid x) + \\frac{\\varepsilon}{K},\\quad d(x,y) = 1 - J\\big(C(x), C(y)\\big)',
		},
	},
} as const;

/**
 * Factory map keyed by strategy id.
 * Kept separate from `STRATEGIES` so the picker can import metadata
 * without pulling in every implementation module.
 */
const STRATEGY_FACTORIES: Record<string, StrategyFactory<unknown>> = {
	absorbing: createAbsorbing as StrategyFactory<unknown>,
	'char-overlap': createCharOverlap as StrategyFactory<unknown>,
	identity: createIdentity as StrategyFactory<unknown>,
	lexical: createLexical as StrategyFactory<unknown>,
	uniform: createUniform as StrategyFactory<unknown>,
};

/**
 * Build the strategy config object for a given id and vocab size.
 *
 * The `absorbing` strategy needs `maskTokenId` (a reserved sentinel equal
 * to `vocabSize`, one past the real vocabulary). The `lexical` strategy
 * carries its lightweight params — the neighborhood provider is loaded
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
export function strategyConfigFor(
	id: string,
	vocabSize: number,
	_extra?: Record<string, unknown>,
): unknown {
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
	if (id === 'char-overlap') {
		return {
			maxDistance: _extra?.maxDistance ?? 0.5,
			k: _extra?.k ?? 50,
			epsilon: _extra?.epsilon ?? 0.01,
			tau: _extra?.tau ?? 1.0,
			mode: _extra?.mode ?? 'set',
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
 * @param provider - Optional lazy neighborhood provider (for lexical).
 * @returns A configured `NoiseStrategy` instance.
 */
export function getStrategy(
	id: string,
	config: unknown,
	vocabSize: number,
	provider?: NeighborhoodProvider,
): NoiseStrategy<unknown> {
	const factory = STRATEGY_FACTORIES[id];
	if (!factory) {
		throw new Error(`Unknown strategy "${id}". Known: ${Object.keys(STRATEGIES).join(', ')}`);
	}
	return factory(config, vocabSize, provider);
}
