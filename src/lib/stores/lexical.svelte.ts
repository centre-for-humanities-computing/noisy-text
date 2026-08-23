import { browser } from '$app/environment';
import { getNeighborTable, putNeighborTable, neighborTableKey } from '$lib/engine/neighbor-cache.js';
import type { LexicalNeighborTable } from '$lib/strategies/lexical-neighbors.js';
import type {
	NeighborWorkerRequest,
	NeighborWorkerResponse,
} from '$lib/workers/neighbors.protocol.js';

export type LexicalStatus = 'idle' | 'precomputing' | 'ready' | 'error';

/**
 * Reactive store for the lexical noise strategy's params and neighbor table.
 *
 * Owns user-configurable params ($k$, $\varepsilon$, `maxDistance`), the
 * precomputation lifecycle (worker spawn, progress, IndexedDB caching),
 * and the current neighbor table handle (lazily loaded inside the
 * trajectory worker, but the store tracks readiness).
 */
class LexicalStore {
	/** Maximum edit distance for neighbor inclusion. */
	maxDistance: number = $state(2);
	/** Maximum neighbors per token. */
	k: number = $state(50);
	/** Ergodicity floor $\varepsilon$. */
	epsilon: number = $state(0.01);

	/** Precomputation status. */
	status: LexicalStatus = $state('idle');
	/** Error message when status is `'error'`. */
	error: string | null = $state(null);
	/** Progress fraction in $[0, 1]$, for progress bar. */
	progress: number = $state(0);

	/** The current tokenizer id (set when precompute starts). */
	private _tokenizerId: string | null = null;

	/** Monotonic request id for staleness detection. */
	private _requestId = 0;
	/** The worker instance, created lazily. */
	private _worker: Worker | null = null;
	/** Re-entrancy guard. */
	private _precomputing = false;

	/** Current params as a plain object (for passing to strategyConfigFor). */
	get params(): Record<string, unknown> {
		return {
			maxDistance: this.maxDistance,
			k: this.k,
			epsilon: this.epsilon,
			tau: 1.0,
		};
	}

	/**
	 * Ensure the neighbor table is ready for the given tokenizer and
	 * current params. Checks IndexedDB/L2 cache, spawns worker on miss.
	 *
	 * Returns `true` if the table is cached (ready), `false` if computation
	 * has been kicked off (status → precomputing).
	 */
	async ensureTable(tokenizerId: string): Promise<boolean> {
		if (!browser) return false;

		const key = neighborTableKey(tokenizerId, this.maxDistance, this.k);

		// Check cache.
		try {
			const cached = await getNeighborTable(key);
			if (cached) {
				this.status = 'ready';
				this.error = null;
				this.progress = 1;
				this._tokenizerId = tokenizerId;
				return true;
			}
		} catch {
			// IDB error — proceed to recompute.
		}

		// Already precomputing for same params?
		if (this._precomputing && this._tokenizerId === tokenizerId) {
			return false;
		}

		// Kick off precomputation.
		this._precomputing = true;
		this._tokenizerId = tokenizerId;
		this.status = 'precomputing';
		this.error = null;
		this.progress = 0;

		const requestId = ++this._requestId;
		const worker = this._getWorker();

		const msg: NeighborWorkerRequest = {
			kind: 'compute',
			requestId,
			tokenizerId,
			maxDistance: this.maxDistance,
			k: this.k,
		};

		worker.onmessage = (event: MessageEvent<NeighborWorkerResponse>) => {
			const resp = event.data;
			if (resp.requestId !== this._requestId) return;

			switch (resp.kind) {
				case 'progress':
					this.progress = resp.total > 0 ? resp.done / resp.total : 1;
					break;

				case 'result': {
					const table: LexicalNeighborTable = {
						neighborIds: resp.neighborIds,
						offsets: resp.offsets,
						weights: resp.weights,
						K: resp.K,
					};
					// Store in IndexedDB (fire and forget).
					putNeighborTable(key, table).catch(() => {
						// Non-critical: table is usable even if IDB write fails.
					});
					this.status = 'ready';
					this.error = null;
					this.progress = 1;
					this._precomputing = false;
					break;
				}

				case 'error':
					this.status = 'error';
					this.error = resp.message;
					this._precomputing = false;
					break;
			}
		};

		worker.postMessage(msg);
		return false;
	}

	/**
	 * Trigger re-precompute when params change (called from $effect).
	 */
	async onParamsChange(tokenizerId: string): Promise<void> {
		if (!browser) return;
		if (!tokenizerId) return;
		await this.ensureTable(tokenizerId);
	}

	private _getWorker(): Worker {
		if (!this._worker) {
			this._worker = new Worker(
				new URL('$lib/workers/neighbors.worker.ts', import.meta.url),
				{ type: 'module' },
			);
		}
		return this._worker;
	}
}

/** Singleton lexical store. */
export const lexicalStore = new LexicalStore();