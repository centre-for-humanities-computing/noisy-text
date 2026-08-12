import { browser } from '$app/environment';
import { randomSeed } from '$lib/engine/rng.js';
import { TrajectoryCache, hashIds } from '$lib/engine/trajectory-cache.js';
import type { Trajectory, TrajectorySpec } from '$lib/engine/types.js';
import type {
	TrajectoryWorkerRequest,
	TrajectoryWorkerResponse,
} from '$lib/workers/trajectory.protocol.js';

export type TrajectoryStatus = 'idle' | 'computing' | 'ready' | 'error';

/**
 * Reactive store for trajectory state.
 *
 * Owns the seed, current slider position $t$, the Web Worker lifecycle,
 * and the in-memory trajectory cache. Follows the same pattern as
 * `tokenizer.svelte.ts` (status union, error string, re-entrancy guard).
 */
class TrajectoryStore {
	/** Current random seed (editable by user). */
	seed: number = $state(42);
	/** Current slider position $t \in [0, T]$. */
	t: number = $state(0);
	/** Computation status. */
	status: TrajectoryStatus = $state('idle');
	/** Error message when status is `'error'`. */
	error: string | null = $state(null);
	/** The computed trajectory, or null. */
	trajectory: Trajectory | null = $state(null);
	/** Progress fraction in $[0, 1]$, for progress bar. */
	progress: number = $state(0);

	/** Monotonic request id for staleness detection. */
	private _requestId = 0;
	/** The worker instance, created lazily. */
	private _worker: Worker | null = null;
	/** In-memory trajectory cache. */
	private _cache = new TrajectoryCache();
	/** Re-entrancy guard: true while a compute is in flight. */
	private _computing = false;
	/** The spec for the in-flight (or most recent) request, for caching. */
	private _pendingSpec: TrajectorySpec | null = null;
	/** Queued spec: stored when a request arrives while already computing. */
	private _queuedSpec: TrajectorySpec | null = null;

	/**
	 * Request a trajectory computation.
	 *
	 * Checks the cache first. If a cache miss, posts to the worker.
	 * Ignores responses for stale requestIds.
	 *
	 * @param spec - The trajectory specification.
	 */
	request(spec: TrajectorySpec): void {
		if (!browser) return;

		const inputHash = hashIds(spec.inputIds);
		const key = TrajectoryCache.key(spec, inputHash);

		// Cache hit — use immediately.
		const cached = this._cache.get(key);
		if (cached) {
			this.trajectory = cached;
			this.status = 'ready';
			this.error = null;
			this.progress = 1;
			this._clampT(spec.T);
			return;
		}

		// Cache miss — compute.
		if (this._computing) {
			// Already computing; queue this spec for when the current one finishes.
			this._queuedSpec = spec;
			return;
		}

		this._computing = true;
		this._pendingSpec = spec;
		this.status = 'computing';
		this.error = null;
		this.progress = 0;
		this._clampT(spec.T);

		const requestId = ++this._requestId;
		const worker = this._getWorker();

		const msg: TrajectoryWorkerRequest = {
			kind: 'compute',
			requestId,
			spec,
		};

		worker.postMessage(msg);
	}

	/**
	 * Force a new random seed and re-compute.
	 * Caller must re-invoke `request()` after this.
	 */
	reroll(): void {
		this.seed = randomSeed();
	}

	/**
	 * Handle a message from the worker.
	 * @internal — called from the worker `onmessage` handler.
	 */
	_handleWorkerMessage(event: MessageEvent<TrajectoryWorkerResponse>): void {
		const msg = event.data;

		// Ignore stale responses.
		if (msg.requestId !== this._requestId) return;

		switch (msg.kind) {
			case 'progress':
				this.progress = msg.total > 0 ? msg.step / msg.total : 1;
				break;

			case 'result': {
				const traj: Trajectory = {
					rows: msg.rows,
					T: msg.T,
					length: msg.length,
					seed: msg.seed,
					tokensAt(t: number): Int32Array {
						return this.rows.subarray(t * this.length, (t + 1) * this.length);
					},
				};
				this.trajectory = traj;
				this.status = 'ready';
				this.error = null;
				this.progress = 1;
				this._computing = false;

				// Cache the result under the spec that triggered it.
				if (this._pendingSpec) {
					const key = TrajectoryCache.key(this._pendingSpec, hashIds(this._pendingSpec.inputIds));
					this._cache.set(key, traj);
					this._pendingSpec = null;
				}

				// Process any queued request.
				this._drainQueue();
				break;
			}

			case 'error':
				this.status = 'error';
				this.error = msg.message;
				this.progress = 0;
				this._computing = false;
				this._pendingSpec = null;

				// Process any queued request.
				this._drainQueue();
				break;
		}
	}

	/** Get or create the worker, wiring up the message handler. */
	private _getWorker(): Worker {
		if (!this._worker) {
			this._worker = new Worker(new URL('$lib/workers/trajectory.worker.ts', import.meta.url), {
				type: 'module',
			});
			this._worker.onmessage = (event: MessageEvent<TrajectoryWorkerResponse>) => {
				this._handleWorkerMessage(event);
			};
		}
		return this._worker;
	}

	/** Clamp $t$ to $[0, T]$ when $T$ shrinks. */
	private _clampT(T: number): void {
		if (this.t > T) {
			this.t = T;
		}
	}

	/** If a spec was queued while computing, send it now. */
	private _drainQueue(): void {
		const queued = this._queuedSpec;
		this._queuedSpec = null;
		if (queued) {
			this.request(queued);
		}
	}
}

export const trajectoryStore = new TrajectoryStore();
