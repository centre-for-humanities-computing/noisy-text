import type { NoiseStrategy, StrategyFactory } from './types.js';
import type { NeighborhoodProvider } from './neighborhood.js';
import { ModelDistanceSource } from './distance-source.js';
import { createTokenKernel } from './token-kernel.js';
import { createKernelStrategy } from './kernel-strategy.js';
import { getWeightFamily } from './weight-family.js';
import type { WeightFamilyId } from './weight-family.js';
import type { EmbeddingSourceId, MetricId, PreprocessId } from '../embeddings/index.js';

/**
 * Configuration for the embedding-knn strategy.
 *
 * At each step, a token $x$ stays with probability $1-\beta_t$, or jumps
 * with probability $\beta_t$ to a destination $y$ drawn from:
 *
 * $$P(y \mid x) = (1 - \varepsilon) \cdot \mathrm{knn}(y \mid x) + \varepsilon / K$$
 *
 * where $\mathrm{knn}(y \mid x) \propto w_\tau(d(x, y))$ over the top-$k$
 * *filtered* embedding neighbours of $x$: the $k$ nearest rows of the
 * LM embedding matrix under the selected metric and preprocessing,
 * after the token-class / exclusion predicate. $d$ is cosine or L2 on
 * preprocessed (optionally int8-dequantized) embedding vectors, so noisy
 * tokens drift to *semantically* related tokens rather than
 * spelling-similar ones.
 *
 * kNN semantics differ from the string models: the neighbourhood is the
 * top-$k$ by metric (a $k$NN graph), not everything within a radius;
 * `maxDistance` is an optional secondary cutoff (`null` = none —
 * `Infinity` is not JSON-serializable).
 *
 * If the filtered neighbour list is empty the kernel term vanishes and
 * $P(y \mid x) = 1/K$. The ergodicity floor $\varepsilon$ guarantees
 * irreducibility regardless of the kNN graph's quality.
 */
export interface EmbeddingKnnConfig {
	/** Which embedding source (and thus which tokenizer pairing). */
	sourceId: EmbeddingSourceId;
	/** Preprocessing applied to rows before distance computation. */
	preprocess: PreprocessId;
	/** Distance metric over preprocessed rows. */
	metric: MetricId;
	/** Token-class filter for jump targets. */
	tokenClass: 'any' | 'word-initial' | 'continuation';
	/** Exclude special tokens (`[CLS]`, `</s>`, …). */
	excludeSpecial: boolean;
	/** Exclude BERT `[unusedN]` padding rows. */
	excludeUnused: boolean;
	/** Exclude byte-fallback tokens (`<0x4F>`). */
	excludeByteFallback: boolean;
	/** Optional secondary distance cutoff; `null` = no cutoff. */
	maxDistance: number | null;
	/** Maximum neighbours per token (kNN list truncation). */
	k: number;
	/** Ergodicity floor $\varepsilon \in [0, 1]$. */
	epsilon: number;
	/** Softmax temperature $\tau$. */
	tau: number;
	/** Weight family for $w_\tau$; defaults to `'exponential'`. */
	family?: WeightFamilyId;
}

export const EMBEDDING_KNN_INFO = {
	id: 'embedding-knn',
	label: 'Embedding kNN',
	description:
		'Tokens transition to semantically-similar tokens based on LM embedding-space nearest neighbours, optionally mixed with uniform noise.',
	stationary: 'data-dependent',
	plainName: 'Drift by language model',
	gloss:
		'Tokens morph into semantically-related tokens ("dog" -> "cat", "run" -> "walk") using language-model embedding space.',
	tooltip: {
		text:
			'At each step, a token either stays the same or jumps to one of its nearest neighbours in a language-model ' +
			'embedding space — tokens the model uses in similar contexts, so jumps follow meaning rather than spelling. ' +
			'An optional uniform floor ε mixes in a little noise so the process stays connected; ' +
			'at ε = 0 tokens only ever jump between embedding neighbours.',
		math:
			'P(y \\mid x) = (1-\\varepsilon)\\,\\mathrm{knn}(y\\mid x) + \\frac{\\varepsilon}{K},\\quad ' +
			'\\mathrm{knn}(y\\mid x) \\propto w_\\tau(d(x,y)),\\ y \\in \\mathrm{top}\\text{-}k\\ \\text{embedding neighbours}',
	},
} as const;

/**
 * Create an embedding-knn strategy.
 *
 * Mirrors `createLexical`: the jump distribution is a `TokenKernel` over
 * the provider's neighbor tables (backed by the embedding kNN index) and
 * the selected weight family; the strategy body is shared
 * `createKernelStrategy`. `sampleStep` therefore draws exactly 2 rng
 * values per call. A `null` provider degenerates to pure uniform.
 */
export const createEmbeddingKnn: StrategyFactory<EmbeddingKnnConfig> = (
	config: EmbeddingKnnConfig,
	vocabSize: number,
	provider?: NeighborhoodProvider,
): NoiseStrategy<EmbeddingKnnConfig> => {
	const family = getWeightFamily(config.family ?? 'exponential');

	const kernel = provider
		? createTokenKernel(new ModelDistanceSource(provider.model, provider), family, {
				k: config.k,
				// `null` means "no cutoff"; the kernel expects a number.
				maxDistance: config.maxDistance ?? Infinity,
				tau: config.tau,
				epsilon: config.epsilon,
				vocabSize,
			})
		: null;

	return createKernelStrategy<EmbeddingKnnConfig>({
		info: EMBEDDING_KNN_INFO,
		config,
		vocabSize,
		kernel,
		epsilon: config.epsilon,
	});
};
