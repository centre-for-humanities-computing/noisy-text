/// <reference lib="webworker" />

/**
 * Trajectory computation Web Worker.
 *
 * Receives a `TrajectoryWorkerRequest`, constructs strategy and schedule
 * from their ids/configs, calls `computeTrajectory`, and posts the result
 * back transferring the `ArrayBuffer`.
 *
 * For the `lexical` strategy, the neighbor table is loaded from IndexedDB
 * inside the worker (keyed by `tokenizerId`, `maxDistance`, `k` — extracted
 * from `strategyConfig`). Non-lexical strategies ignore this.
 *
 * Progress is posted for runs where $(T+1) \times L > 10\,000$ cells,
 * throttled to at most every 5% of $T$.
 */

import { computeTrajectory } from '../engine/trajectory.js';
import { createRng } from '../engine/rng.js';
import { neighborTableKey, getNeighborTable } from '../engine/neighbor-cache.js';
import { getStrategy } from '../strategies/index.js';
import { getSchedule } from '../schedules/index.js';
import type { TrajectoryWorkerRequest, TrajectoryWorkerResponse } from './trajectory.protocol.js';

const PROGRESS_THRESHOLD = 10_000;

self.onmessage = (event: MessageEvent<TrajectoryWorkerRequest>) => {
	const msg = event.data;
	if (msg.kind !== 'compute') return;

	const { requestId, spec } = msg;

	(async () => {
		try {
			// For lexical: load neighbor table from IndexedDB.
			let table = undefined;
			if (spec.strategyId === 'lexical') {
				const config = spec.strategyConfig as { maxDistance?: number; k?: number };
				if (config.maxDistance !== undefined && config.k !== undefined) {
					const key = neighborTableKey(spec.tokenizerId, config.maxDistance, config.k);
					table = await getNeighborTable(key);
				}
			}

			const strategy = getStrategy(spec.strategyId, spec.strategyConfig, spec.vocabSize, table);
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
