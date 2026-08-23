/// <reference lib="webworker" />

/**
 * Neighbor-table precomputation Web Worker.
 *
 * Loads its own tokenizer instance, decodes all $K$ token strings,
 * computes the top-$k$ neighbor table via edit distance, and posts
 * the result back (transferring typed-array buffers).
 *
 * Progress is reported via `postMessage` every 1024 tokens.
 */

import { loadTokenizer } from '../tokenizers/index.js';
import { computeNeighborTable, normalizeTokenString } from '../strategies/lexical-neighbors.js';
import type { NeighborWorkerRequest, NeighborWorkerResponse } from './neighbors.protocol.js';

self.onmessage = (event: MessageEvent<NeighborWorkerRequest>) => {
	const msg = event.data;
	if (msg.kind !== 'compute') return;

	const { requestId, tokenizerId, maxDistance, k } = msg;

	(async () => {
		try {
			// Load the tokenizer (independent copy in this worker).
			const tok = await loadTokenizer(tokenizerId);

			const K = tok.vocabSize;

			// Decode all token ids to strings, then normalize.
			// Build the id→string array by decoding one id at a time
			// via idsToTokens, which is per-id cheap.
			const strings: string[] = [];
			// Process in chunks to report progress and avoid blocking
			// the event loop for too long.
			const CHUNK = 4096;
			for (let offset = 0; offset < K; offset += CHUNK) {
				const end = Math.min(offset + CHUNK, K);
				const ids = new Int32Array(end - offset);
				for (let i = offset; i < end; i++) ids[i - offset] = i;
				const raw = tok.idsToTokens(ids);
				for (const r of raw) {
					strings.push(normalizeTokenString(r));
				}
				// Yield to the event loop so we don't hang the worker.
				await new Promise((r) => setTimeout(r, 0));
			}

			// Compute the neighbor table.
			const table = computeNeighborTable(strings, { maxDistance, k, tau: 1.0 }, (done, total) => {
				const response: NeighborWorkerResponse = {
					kind: 'progress',
					requestId,
					done,
					total,
				};
				self.postMessage(response);
			});

			// Post result, transferring the buffers.
			const response: NeighborWorkerResponse = {
				kind: 'result',
				requestId,
				neighborIds: table.neighborIds,
				offsets: table.offsets,
				weights: table.weights,
				K: table.K,
			};
			self.postMessage(response, {
				transfer: [table.neighborIds.buffer, table.offsets.buffer, table.weights.buffer],
			});
		} catch (e: unknown) {
			const response: NeighborWorkerResponse = {
				kind: 'error',
				requestId,
				message: e instanceof Error ? e.message : String(e),
			};
			self.postMessage(response);
		}
	})();
};