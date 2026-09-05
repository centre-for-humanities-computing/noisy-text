/// <reference lib="webworker" />

/**
 * Trajectory computation Web Worker.
 *
 * Receives a `TrajectoryWorkerRequest`, constructs strategy and schedule
 * from their ids/configs, calls `computeTrajectory`, and posts the result
 * back transferring the `ArrayBuffer`.
 *
 * For the `lexical` strategy, an `EditDistanceModel` + `NeighborhoodProvider`
 * is built lazily per tokenizer (decoding all $K$ token strings once, then
 * computing neighborhoods on-demand during the walk). The model/provider
 * pair is cached in the worker for the lifetime of the tokenizer.
 *
 * Progress is posted for runs where $(T+1) \times L > 10\,000$ cells,
 * throttled to at most every 5% of $T$.
 */

import { computeTrajectory } from '../engine/trajectory.js';
import { createRng } from '../engine/rng.js';
import { getStrategy } from '../strategies/index.js';
import { getSchedule } from '../schedules/index.js';
import { loadTokenizer } from '../tokenizers/index.js';
import { EditDistanceModel } from '../strategies/distance-model.js';
import { NeighborhoodProvider } from '../strategies/neighborhood.js';
import type { TrajectoryWorkerRequest, TrajectoryWorkerResponse } from './trajectory.protocol.js';

const PROGRESS_THRESHOLD = 10_000;

/**
 * Fixed radius ceiling for the lexical neighborhood provider.
 * All neighbors within this edit distance are cached; $k$ and
 * `maxDistance` (≤ R_MAX) are applied at read time in the strategy.
 */
const R_MAX = 3;

/**
 * Cached model/provider pair per tokenizer id.
 * The model decodes all $K$ strings once; the provider memoizes
 * per-token neighborhoods computed on first visit during the walk.
 */
const _lexicalCache = new Map<string, { model: EditDistanceModel; provider: NeighborhoodProvider }>();

/**
 * Ensure the EditDistanceModel + NeighborhoodProvider are ready for a
 * tokenizer. Decodes all $K$ token strings (one-time cost per tokenizer
 * lifetime), builds the model, and wraps it in a provider.
 */
async function ensureLexicalProvider(
	tokenizerId: string,
): Promise<NeighborhoodProvider> {
	const cached = _lexicalCache.get(tokenizerId);
	if (cached) return cached.provider;

	const tok = await loadTokenizer(tokenizerId);
	const K = tok.vocabSize;

	// Decode all token ids to strings.
	const strings: string[] = [];
	const CHUNK = 4096;
	for (let offset = 0; offset < K; offset += CHUNK) {
		const end = Math.min(offset + CHUNK, K);
		const ids = new Int32Array(end - offset);
		for (let i = offset; i < end; i++) ids[i - offset] = i;
		const raw = tok.idsToTokens(ids);
		for (const r of raw) {
			strings.push(r);
		}
		// Yield to the event loop.
		await new Promise((r) => setTimeout(r, 0));
	}

	const model = new EditDistanceModel(strings);
	const provider = new NeighborhoodProvider(model, R_MAX);
	_lexicalCache.set(tokenizerId, { model, provider });
	return provider;
}

self.onmessage = (event: MessageEvent<TrajectoryWorkerRequest>) => {
	const msg = event.data;
	if (msg.kind !== 'compute') return;

	const { requestId, spec } = msg;

	(async () => {
		try {
			// For lexical: build (or reuse) the neighborhood provider.
			let provider: NeighborhoodProvider | undefined;
			if (spec.strategyId === 'lexical') {
				provider = await ensureLexicalProvider(spec.tokenizerId);
			}

			const strategy = getStrategy(spec.strategyId, spec.strategyConfig, spec.vocabSize, provider);
			const schedule = getSchedule(spec.scheduleId, spec.scheduleConfig, spec.T);
			const rng = createRng(spec.seed);

			const totalCells = (spec.T + 1) * spec.inputIds.length;
			const shouldReportProgress = totalCells > PROGRESS_THRESHOLD;

			const traj = computeTrajectory(spec.inputIds, { strategy, schedule, rng }, (progress) => {
				if (shouldReportProgress) {
					const response: TrajectoryWorkerResponse = {
						kind: 'progress',
						requestId,
						step: progress.step,
						total: progress.total,
					};
					self.postMessage(response);
				}
			});

			const response: TrajectoryWorkerResponse = {
				kind: 'result',
				requestId,
				rows: traj.rows,
				T: traj.T,
				length: traj.length,
				seed: spec.seed,
			};

			// Transfer the ArrayBuffer to avoid copying.
			self.postMessage(response, { transfer: [traj.rows.buffer] });
		} catch (e: unknown) {
			const response: TrajectoryWorkerResponse = {
				kind: 'error',
				requestId,
				message: e instanceof Error ? e.message : String(e),
			};
			self.postMessage(response);
		}
	})();
};
