/**
 * Message protocol for the trajectory Web Worker.
 *
 * Uses discriminated unions so both sides can narrow on `kind`.
 * The worker receives a spec and constructs strategy/schedule internally;
 * no closures cross the worker boundary.
 */

import type { TrajectorySpec } from '../engine/types.js';

// ---- Requests (main → worker) ----

export interface TrajectoryWorkerComputeRequest {
	kind: 'compute';
	/** Monotonic request id for staleness detection. */
	requestId: number;
	/** The trajectory spec (all fields serializable). */
	spec: TrajectorySpec;
}

export type TrajectoryWorkerRequest = TrajectoryWorkerComputeRequest;

// ---- Responses (worker → main) ----

export interface TrajectoryWorkerProgressResponse {
	kind: 'progress';
	requestId: number;
	/** Current step (0-based, $0 \le \text{step} < T$). */
	step: number;
	/** Total number of steps $T$. */
	total: number;
}

export interface TrajectoryWorkerResultResponse {
	kind: 'result';
	requestId: number;
	/** The computed trajectory rows buffer, transferred. */
	rows: Int32Array;
	/** Number of noise steps $T$. */
	T: number;
	/** Sequence length $L$. */
	length: number;
	/** The seed used. */
	seed: number;
}

export interface TrajectoryWorkerErrorResponse {
	kind: 'error';
	requestId: number;
	message: string;
}

export type TrajectoryWorkerResponse =
	| TrajectoryWorkerProgressResponse
	| TrajectoryWorkerResultResponse
	| TrajectoryWorkerErrorResponse;
