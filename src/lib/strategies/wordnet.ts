import type {
	NoiseStrategy,
	Rng,
	StrategyFactory,
	StrategyResources,
	StrategyInfo,
} from './types.js';
import type { KernelRow, TokenKernel } from './token-kernel.js';
import type { WordNetResource } from '../wordnet/table.js';

/**
 * Configuration for the WordNet strategy (no knobs).
 *
 * At each step, a token $x$ stays with probability $1-\beta_t$, or jumps
 * with probability $\beta_t$ to a WordNet relation target. Outbound edges
 * are grouped by relation category (hypernym, hyponym, synonym, meronym,
 * holonym). Each non-empty category $c$ receives equal mass
 * $1/m(x)$, where $m(x)$ is the number of non-empty categories, shared
 * uniformly across that category's targets $T_c(x)$:
 *
 * $$P(y \mid x) = (1-\beta_t)\,\mathbf{1}[y=x]
 *   + \beta_t \sum_c \frac{\mathbf{1}[y \in T_c(x)]}{m(x)\,|T_c(x)|}$$
 *
 * A lemma with no outbound edge stays put; there is no uniform fallback.
 * The config is empty so the trajectory cache key is stable.
 */
export type WordNetConfig = Record<string, never>;

/** Metadata shown in the strategy picker and tooltip. */
export const WORDNET_INFO: StrategyInfo = {
	id: 'wordnet',
	label: 'WordNet taxonomy',
	description:
		'Tokens walk WordNet relation edges — hypernyms, hyponyms, synonyms, meronyms and holonyms.',
	stationary: 'data-dependent',
	plainName: 'Drift through meanings',
	gloss:
		'Words climb and descend the WordNet taxonomy — a dog becomes a canine, then an animal, then a broader kind of thing.',
	tooltip: {
		text: 'At each step, a token either stays the same or jumps to a WordNet neighbour. Outbound edges are grouped into five relation categories — hypernyms, hyponyms, synonyms, meronyms and holonyms. Each non-empty category gets equal mass, shared uniformly across its targets, so a word with two kinds of relation is equally likely to take either kind. A token with no outbound edge stays put.',
		math: 'P(y \\mid x) = (1-\\beta_t)\\,\\mathbf{1}[y=x] + \\beta_t K(y\\mid x),\\quad K(y\\mid x) = \\frac{\\mathbf{1}[y \\in T_c(x)]}{m(x)\\,|T_c(x)|}',
	},
};

const EMPTY_ROW: KernelRow = { ids: new Int32Array(0), probs: new Float32Array(0) };

/**
 * One sparse transition row per WordNet lemma row.
 *
 * Probabilities are computed from the bundle's CSR arrays: count edges per
 * category, then give every non-empty category mass $1/m$ and every edge
 * inside it $1/(m\,|T_c|)$. Empty rows sample to the current token, so an
 * uncovered token never jumps.
 */
export function createWordNetKernel(resource: WordNetResource): TokenKernel {
	const bundle = resource.table.bundle;
	const rows = resource.rows;
	const cache = new Map<number, KernelRow>();
	const counts = new Uint32Array(bundle.meta.categoryOrder.length);

	function getRow(token: number): KernelRow {
		const index = rows[token];
		if (index === undefined || index < 0) return EMPTY_ROW;
		const cached = cache.get(index);
		if (cached) return cached;

		const start = bundle.offsets[index]!;
		const end = bundle.offsets[index + 1]!;
		counts.fill(0);
		let nonEmpty = 0;
		for (let e = start; e < end; e++) {
			const category = bundle.categories[e]!;
			if (counts[category] === 0) nonEmpty++;
			counts[category]!++;
		}
		if (nonEmpty === 0) {
			cache.set(index, EMPTY_ROW);
			return EMPTY_ROW;
		}

		const ids = new Int32Array(end - start);
		const probs = new Float32Array(end - start);
		const mass = 1 / nonEmpty;
		for (let e = start; e < end; e++) {
			const category = bundle.categories[e]!;
			ids[e - start] = bundle.targets[e]!;
			probs[e - start] = mass / counts[category]!;
		}
		const row = { ids, probs };
		cache.set(index, row);
		return row;
	}

	return {
		getRow,
		sampleStep(token: number, rng: Rng): number {
			// Draw unconditionally so the kernel always consumes exactly one
			// value, even when the row is empty.
			const draw = rng();
			const row = getRow(token);
			if (row.ids.length === 0) return token;

			let cumulative = 0;
			for (let i = 0; i < row.probs.length; i++) {
				cumulative += row.probs[i]!;
				if (draw < cumulative) return row.ids[i]!;
			}
			// Float round-off can leave the last boundary just short of 1.
			return row.ids[row.ids.length - 1]!;
		},
	};
}

/**
 * Create the WordNet taxonomy-walk strategy.
 *
 * Draws exactly two values per step to preserve the engine's RNG contract:
 * one for the $\beta_t$ coin and one handed to the kernel for the jump.
 * Without a WordNet resource the strategy stays put rather than falling
 * back to a uniform jump.
 */
export const createWordNet: StrategyFactory<WordNetConfig> = (
	_config: WordNetConfig,
	_vocabSize: number,
	resources: StrategyResources = {},
): NoiseStrategy<WordNetConfig> => {
	const kernel = resources.wordnet ? createWordNetKernel(resources.wordnet) : null;

	return {
		info: WORDNET_INFO,
		config: {},

		sampleStep(token: number, beta: number, rng: Rng): number {
			const coin = rng();
			const draw = rng();
			if (coin >= beta) return token;
			if (!kernel) return token;
			return kernel.sampleStep(token, (): number => draw);
		},
	};
};
