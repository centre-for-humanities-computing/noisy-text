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
export { CharOverlapModel } from './char-overlap-model.js';
export type { DistanceModel } from './distance-model.js';
export { EditDistanceModel, levenshtein } from './distance-model.js';
export type { NeighborEntry } from './neighborhood.js';
export { NeighborhoodProvider } from './neighborhood.js';
