export type {
	NoiseStrategy,
	StrategyFactory,
	StrategyInfo,
	StationaryBehavior,
	Rng,
} from './types.js';
export { STRATEGIES, getStrategy, strategyConfigFor } from './registry.js';
export { createAbsorbing } from './absorbing.js';
export { createUniform } from './uniform.js';
export { createLexical } from './lexical.js';
export type { LexicalConfig } from './lexical.js';
export { createCharOverlap } from './char-overlap.js';
export type { CharOverlapConfig } from './char-overlap.js';
export { createEmbeddingKnn, EMBEDDING_KNN_INFO } from './embedding-knn.js';
export type { EmbeddingKnnConfig } from './embedding-knn.js';
export { classifyTokens, buildTokenPredicate, TOKEN_FLAG } from './embedding-filter.js';
export type { TokenClass } from './embedding-filter.js';
export { CharOverlapModel } from './char-overlap-model.js';
export type { CharOverlapMode } from './char-overlap-model.js';
export type { DistanceModel } from './distance-model.js';
export { EditDistanceModel, levenshtein } from './distance-model.js';
export type { NeighborEntry } from './neighborhood.js';
export { NeighborhoodProvider } from './neighborhood.js';
export type { WeightFamily, WeightFamilyId } from './weight-family.js';
export {
	WEIGHT_FAMILIES,
	getWeightFamily,
	isWeightFamilyId,
	MIN_TAU,
	clampTau,
} from './weight-family.js';
export type { DistanceSource, NeighborTable } from './distance-source.js';
export { ModelDistanceSource } from './distance-source.js';
export type { KernelParams, KernelRow, TokenKernel } from './token-kernel.js';
export { createTokenKernel, createUniformKernel, kernelRowToDense } from './token-kernel.js';
export type { KernelStrategyOptions } from './kernel-strategy.js';
export { createKernelStrategy } from './kernel-strategy.js';
export type { DistanceFn, StringDistanceKernel, StringFn } from './string-distance-kernel.js';
export {
	STRING_DISTANCE_KERNELS,
	getStringDistanceKernel,
	stringDistanceKernelFor,
} from './string-distance-kernel.js';
