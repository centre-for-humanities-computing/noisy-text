/**
 * Shared strategy body for kernel-based noise strategies.
 *
 * Wraps a `TokenKernel` with the $\beta_t$ coin: with probability
 * $1 - \beta_t$ the token stays, with probability $\beta_t$ it jumps
 * through the kernel:
 *
 * $$Q_t(y \mid x) = (1 - \beta_t)\,\mathbb{1}[y = x] + \beta_t\,K(y \mid x)$$
 *
 * where $K$ is the kernel's jump distribution (already mixed with the
 * ergodicity floor $\varepsilon$ inside the kernel). A `null` kernel
 * means "no neighbor table available" — jumps are uniform over the vocab.
 *
 * `sampleStep` draws exactly **2** rng values per call in every branch
 * (stay included), keeping the RNG stream path-independent as documented
 * in `engine/README.md`. On a kernel jump the second draw is handed to
 * the kernel, which consumes exactly one rng value.
 */

import type { NoiseStrategy, Rng, StrategyInfo } from './types.js';
import type { TokenKernel } from './token-kernel.js';
import { kernelRowToDense } from './token-kernel.js';

export interface KernelStrategyOptions<Config> {
	info: StrategyInfo;
	config: Config;
	vocabSize: number;
	/** Kernel used on a jump; `null` means "no table → uniform over vocab". */
	kernel: TokenKernel | null;
	/** Ergodicity floor $\varepsilon$, used for the dense jump row only. */
	epsilon: number;
}

/**
 * Build a `NoiseStrategy` from a kernel and the $\beta$ coin.
 *
 * `getLocalDistribution` returns the floor-mixed jump row (it ignores
 * $\beta$ — the stay mass is the coin, not part of the jump row) in a
 * reused buffer; callers must not retain the returned reference.
 */
export function createKernelStrategy<Config>(
	opts: KernelStrategyOptions<Config>,
): NoiseStrategy<Config> {
	const { info, config, vocabSize, kernel, epsilon } = opts;

	// Pre-allocated buffer for getLocalDistribution.
	const _dist = new Float32Array(vocabSize);
	const _uniformWeight = 1 / vocabSize;

	return {
		info,
		config,

		sampleStep(token: number, beta: number, rng: Rng): number {
			// Draw exactly 2 values to keep the RNG stream path-independent —
			// the second draw happens even on the stay branch (legacy
			// contract, pinned by the strategy tests).
			const coin = rng(); // whether to jump
			const draw = rng(); // compound: floor-vs-kernel + token index
			if (coin >= beta) return token;
			if (kernel === null) {
				return Math.min(Math.floor(draw * vocabSize), vocabSize - 1);
			}
			// The kernel draws exactly 1 value; hand it the already-drawn one.
			return kernel.sampleStep(token, (): number => draw);
		},

		getLocalDistribution(token: number, _beta: number): Float32Array {
			if (kernel === null) {
				_dist.fill(_uniformWeight);
			} else {
				kernelRowToDense(_dist, kernel.getRow(token), epsilon, vocabSize);
			}
			return _dist;
		},
	};
}
