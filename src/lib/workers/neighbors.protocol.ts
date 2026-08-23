/**
 * Message protocol for the neighbor-table precomputation Web Worker.
 * Uses discriminated unions on `kind` — no closures cross the boundary.
 */

// ---- Requests (main → worker) ----

export interface NeighborWorkerComputeRequest {
	kind: 'compute';
	/** Monotonic request id for staleness detection. */
	requestId: number;
	/** Tokenizer id (e.g. 'gpt2'). */
	tokenizerId: string;
	/** Maximum edit distance for neighbor inclusion. */
	maxDistance: number;
	/** Maximum neighbors per token. */
	k: number;
}

export type NeighborWorkerRequest = NeighborWorkerComputeRequest;

// ---- Responses (worker → main) ----

export interface NeighborWorkerProgressResponse {
	kind: 'progress';
	requestId: number;
	/** Tokens processed so far */
	done: number;
	/** Total tokens $K$ */
	total: number;
}

export interface NeighborWorkerResultResponse {
	kind: 'result';
	requestId: number;
	/** Concatenated neighbor token ids (CSR values). Transferred. */
	neighborIds: Int32Array;
	/** Offsets into `neighborIds`/`weights`. Length $K+1$. Transferred. */
	offsets: Int32Array;
	/** Precomputed softmax weights, parallel to `neighborIds`. Transferred. */
	weights: Float32Array;
	/** Vocabulary size $K$. */
	K: number;
}

export interface NeighborWorkerErrorResponse {
	kind: 'error';
	requestId: number;
	message: string;
}

export type NeighborWorkerResponse =
	| NeighborWorkerProgressResponse
	| NeighborWorkerResultResponse
	| NeighborWorkerErrorResponse;