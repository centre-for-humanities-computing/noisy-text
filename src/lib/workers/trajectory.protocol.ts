/**
 * Message protocol for the trajectory Web Worker.
 *
 * Uses discriminated unions so both sides can narrow on `kind`.
 * The worker receives a spec and constructs strategy/schedule internally;
 * no closures cross the worker boundary.
 */

import type { TrajectorySpec } from '../engine/types.js';
import type { ConnectivityReport } from '../engine/connectivity.js';

// ---- Requests (main → worker) ----

export interface TrajectoryWorkerComputeRequest {
	kind: 'compute';
	/** Monotonic request id for staleness detection. */
	requestId: number;
	/** The trajectory spec (all fields serializable). */
	spec: TrajectorySpec;
}

/**
 * Query the inspection graph for the hover tooltip.
 *
 * Asks the worker to build a graph showing the hovered token's trajectory
 * (the chain of tokens $x_0 \to x_1 \to \cdots \to x_t$ at one sequence
 * position) plus the 1-hop neighborhood of the current token. Edge
 * weights are exact transition probabilities $Q_s(x_{s+1} \mid x_s)$
 * computed by the strategy. Neighborhoods exclude the ergodicity floor.
 *
 * The trajectory column and per-step $\beta$ values are supplied by the
 * main thread (it owns the computed trajectory); the worker owns the
 * strategy instance needed to evaluate $Q_s$.
 */
export interface TrajectoryWorkerNeighborsRequest {
	kind: 'neighbors';
	/** Monotonic request id (separate counter from compute requests). */
	requestId: number;
	tokenizerId: string;
	strategyId: string;
	/** Strategy config (maxDistance, k, tau, mode, …) for read-time filtering. */
	strategyConfig: Record<string, unknown>;
	/** Vocabulary size $K$ (needed to instantiate the strategy). */
	vocabSize: number;
	/** The hovered token's trajectory column: $x_0, x_1, \ldots, x_t$. */
	column: Int32Array;
	/** Schedule $\beta$ values: $\beta_0, \ldots, \beta_{t-1}$ (length = column.length - 1). */
	betas: Float32Array;
	/** Spread limit mode for the neighborhood. */
	limitMode: 'top-k' | 'top-p';
	/** Top-k cutoff (used when `limitMode === 'top-k'`). */
	k: number;
	/** Cumulative probability cutoff in $[0, 1]$ (used when `limitMode === 'top-p'`). */
	p: number;
}

/**
 * Build the **union graph** for the full-graph view: one token-space
 * graph merging the trajectories of *all* positions over all steps
 * $0..T$, plus the 1-hop neighborhood of every trajectory node (when
 * the strategy supports one), laid out with the large force layout.
 *
 * The full rows buffer is copied by the main thread and transferred;
 * the worker builds the graph and layout in chunks, posting progress
 * (`union-graph-progress`) and aborting early when a newer request
 * supersedes this one.
 */
export interface TrajectoryWorkerUnionGraphRequest {
	kind: 'union-graph';
	/**
	 * Monotonic request id from the graph store's own counter. The worker
	 * honors only the newest union-graph request id; older builds abort.
	 */
	requestId: number;
	tokenizerId: string;
	strategyId: string;
	/** Strategy config (maxDistance, k, tau, mode, …) for read-time filtering. */
	strategyConfig: Record<string, unknown>;
	/** Vocabulary size $K$; the mask sentinel id is also $K$. */
	vocabSize: number;
	/** Full trajectory rows, row-major $(T+1) \times L$ (transferred). */
	rows: Int32Array;
	/** Number of noise steps $T$. */
	T: number;
	/** Sequence length $L$. */
	L: number;
	/** Spread limit mode for the neighborhood. */
	limitMode: 'top-k' | 'top-p';
	/** Top-k cutoff (used when `limitMode === 'top-k'`). */
	k: number;
	/** Cumulative probability cutoff in $[0, 1]$ (used when `limitMode === 'top-p'`). */
	p: number;
}

export type TrajectoryWorkerRequest =
	| TrajectoryWorkerComputeRequest
	| TrajectoryWorkerNeighborsRequest
	| TrajectoryWorkerUnionGraphRequest;

// ---- Responses (worker → main) ----

/** Computation phase a progress message refers to. */
export type TrajectoryWorkerPhase = 'preparing' | 'materializing' | 'embeddings' | 'walking';

/** Phases of the union-graph build: neighborhood pass, then layout. */
export type UnionGraphPhase = 'neighbors' | 'layout';

export interface TrajectoryWorkerProgressResponse {
	kind: 'progress';
	requestId: number;
	/** Which phase the progress refers to. */
	phase: TrajectoryWorkerPhase;
	/** Units completed in the current phase. */
	step: number;
	/** Total units in the current phase. */
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
	/** Role in the graph: `'trajectory'` (on the walked path) or `'neighbor'`. */
	role: 'trajectory' | 'neighbor';
	/**
	 * Chronology anchor: the trajectory step $s$ at which this token
	 * appeared (first occurrence for trajectory nodes; the anchor step
	 * for neighbors). Drives the saturation ramp.
	 */
	anchorStep: number;
	/** Display string for the token. */
	label: string;
}

/** A directed edge in the inspection graph. */
export interface NeighborGraphEdge {
	/** Source token id. */
	from: number;
	/** Target token id. */
	to: number;
	/**
	 * Edge weight in $[0, 1]$: for trajectory edges the exact transition
	 * probability $Q_s(x_{s+1} \mid x_s)$; for neighborhood edges the
	 * floor-free softmax weight over $-d/\tau$.
	 */
	weight: number;
	/** Raw distance between the endpoints (0 for trajectory edges). */
	dist: number;
	/** Whether this edge is on the walked trajectory. */
	trajectory: boolean;
	/**
	 * Chronology anchor: the step $s$ at which this transition happened
	 * (trajectory edges) or the anchor step of the neighborhood
	 * (neighborhood edges). Drives the saturation ramp.
	 */
	anchorStep: number;
	/**
	 * The trajectory steps $s$ at which this transition was taken
	 * (trajectory edges only; a token pair can recur). Empty for
	 * neighborhood edges.
	 */
	steps: number[];
}

/** The inspection graph: trajectory chain + 1-hop neighborhood. */
export interface NeighborGraph {
	nodes: NeighborGraphNode[];
	edges: NeighborGraphEdge[];
	/**
	 * Whether a neighborhood could be computed. `false` when the strategy
	 * has no neighborhood support (uniform) or no neighbors were in range
	 * — the trajectory is still present either way.
	 */
	hasNeighborhood: boolean;
}

export interface TrajectoryWorkerNeighborsResultResponse {
	kind: 'neighbors';
	requestId: number;
	/** The built graph (always non-null; check `hasNeighborhood`). */
	graph: NeighborGraph;
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

/** The built union graph with its layout, in compact typed-array form. */
export interface UnionGraph {
	/** Number of nodes; all per-node arrays have this length. */
	nodeCount: number;
	/** Number of noise steps the graph was built over. */
	T: number;
	/** Token id per node (the mask sentinel is the vocab size). */
	ids: Int32Array;
	/** First step any position held this token; $-1$ for neighbor-only nodes. */
	trajStep: Int32Array;
	/** Step at which the node becomes visible ($t \ge$ `revealStep`). */
	revealStep: Int32Array;
	/** Display string per node. */
	labels: string[];
	/** Edge endpoints as node indices. */
	edgeSrc: Int32Array;
	edgeDst: Int32Array;
	/** Step at which the edge becomes visible ($t \ge$ `firstStep`). */
	edgeFirstStep: Int32Array;
	/** How many times any position took a trajectory edge (1 for neighbor edges). */
	edgeCount: Int32Array;
	/** 1 for trajectory edges, 0 for neighborhood edges. */
	edgeTraj: Uint8Array;
	hasNeighborhood: boolean;
	/** True when the size guards shrank or skipped the neighborhood. */
	truncated: boolean;
	/** Connectivity of the neighbourhood graph; `null` without a neighbourhood. */
	connectivity: ConnectivityReport | null;
	/** Layout positions (world units). */
	layoutX: Float32Array;
	layoutY: Float32Array;
}

export interface TrajectoryWorkerUnionGraphProgressResponse {
	kind: 'union-graph-progress';
	requestId: number;
	phase: UnionGraphPhase;
	/** Units completed in the current phase. */
	step: number;
	/** Total units in the current phase. */
	total: number;
}

export interface TrajectoryWorkerUnionGraphResultResponse {
	kind: 'union-graph';
	requestId: number;
	graph: UnionGraph;
}

export interface TrajectoryWorkerUnionGraphErrorResponse {
	kind: 'union-graph-error';
	requestId: number;
	message: string;
}

export type TrajectoryWorkerResultResponse =
	| TrajectoryWorkerComputeResultResponse
	| TrajectoryWorkerNeighborsResultResponse
	| TrajectoryWorkerUnionGraphResultResponse;

export type TrajectoryWorkerErrorResponse =
	| TrajectoryWorkerComputeErrorResponse
	| TrajectoryWorkerNeighborsErrorResponse
	| TrajectoryWorkerUnionGraphErrorResponse;

export type TrajectoryWorkerResponse =
	| TrajectoryWorkerProgressResponse
	| TrajectoryWorkerResultResponse
	| TrajectoryWorkerErrorResponse
	| TrajectoryWorkerUnionGraphProgressResponse;
