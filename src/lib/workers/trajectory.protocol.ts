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

/**
 * Query the local token neighborhood for the hover tooltip.
 *
 * Asks the worker to build a 2-hop neighborhood graph centered on `token`
 * using its cached `NeighborhoodProvider` (floor-free: the ergodicity
 * floor $\varepsilon$ is excluded). Each hop's spread is limited by
 * `limitMode` (`'top-k'` or `'top-p'`).
 */
export interface TrajectoryWorkerNeighborsRequest {
	kind: 'neighbors';
	/** Monotonic request id (separate counter from compute requests). */
	requestId: number;
	tokenizerId: string;
	strategyId: string;
	/** Strategy config (maxDistance, k, tau, mode, …) for read-time filtering. */
	strategyConfig: Record<string, unknown>;
	/** Center token id. */
	token: number;
	/** Spread limit mode per hop. */
	limitMode: 'top-k' | 'top-p';
	/** Top-k cutoff (used when `limitMode === 'top-k'`). */
	k: number;
	/** Cumulative probability cutoff in $[0, 1]$ (used when `limitMode === 'top-p'`). */
	p: number;
}

export type TrajectoryWorkerRequest =
	| TrajectoryWorkerComputeRequest
	| TrajectoryWorkerNeighborsRequest;

// ---- Responses (worker → main) ----

export interface TrajectoryWorkerProgressResponse {
	kind: 'progress';
	requestId: number;
	/** Current step (0-based, $0 \le \text{step} < T$). */
	step: number;
	/** Total number of steps $T$. */
	total: number;
}

export interface TrajectoryWorkerComputeResultResponse {
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

/** A node in the neighborhood graph. */
export interface NeighborGraphNode {
	/** Token id. */
	id: number;
	/** Hop distance from the center (0 = center, 1 = neighbor, 2 = 2-hop). */
	hop: number;
	/** Display string for the token. */
	label: string;
}

/** A directed edge in the neighborhood graph. */
export interface NeighborGraphEdge {
	/** Source token id (closer to center). */
	from: number;
	/** Target token id (farther from center). */
	to: number;
	/** Floor-free transition weight in $[0, 1]$ (softmax over $-d/\tau$). */
	weight: number;
	/** Raw distance between the endpoints. */
	dist: number;
}

/** The 2-hop neighborhood graph for the tooltip. */
export interface NeighborGraph {
	nodes: NeighborGraphNode[];
	edges: NeighborGraphEdge[];
}

export interface TrajectoryWorkerNeighborsResultResponse {
	kind: 'neighbors';
	requestId: number;
	/** The built graph, or null when the strategy has no neighborhood. */
	graph: NeighborGraph | null;
}

export interface TrajectoryWorkerComputeErrorResponse {
	kind: 'error';
	requestId: number;
	message: string;
}

export interface TrajectoryWorkerNeighborsErrorResponse {
	kind: 'neighbors-error';
	requestId: number;
	message: string;
}

export type TrajectoryWorkerResultResponse =
	| TrajectoryWorkerComputeResultResponse
	| TrajectoryWorkerNeighborsResultResponse;

export type TrajectoryWorkerErrorResponse =
	| TrajectoryWorkerComputeErrorResponse
	| TrajectoryWorkerNeighborsErrorResponse;

export type TrajectoryWorkerResponse =
	| TrajectoryWorkerProgressResponse
	| TrajectoryWorkerResultResponse
	| TrajectoryWorkerErrorResponse;
