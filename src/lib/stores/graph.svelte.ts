import { browser } from '$app/environment';
import { trajectoryStore } from './trajectory.svelte.js';
import type {
	TrajectoryWorkerResponse,
	TrajectoryWorkerUnionGraphRequest,
	TrajectoryWorkerUnionGraphProgressResponse,
	UnionGraph,
	UnionGraphPhase,
} from '$lib/workers/trajectory.protocol.js';

export type GraphStatus = 'idle' | 'computing' | 'ready' | 'error';

/** Inputs for a union-graph build; all serializable (rows are copied). */
export interface UnionGraphRequestOpts extends Omit<
	TrajectoryWorkerUnionGraphRequest,
	'kind' | 'requestId' | 'rows'
> {
	rows: Int32Array;
	/** Cache key: everything the graph depends on (spec + limits). */
	key: string;
}

/** Number of built graphs kept in the FIFO cache. */
const CACHE_MAX = 4;

/**
 * Reactive store for the full-graph view's union graph.
 *
 * Owns the request lifecycle (status, progress, caching) for the
 * union-graph builds; the worker is shared with the trajectory store.
 * Computes lazily — `request()` is only called when the graph view is
 * active.
 *
 * Each cache miss is posted to the worker right away. The worker aborts
 * an older build at its next checkpoint (it only honors the newest
 * request id), and this store drops that build's messages by request id.
 */
class GraphStore {
	/** Build status. */
	status: GraphStatus = $state('idle');
	/** Error message when status is `'error'`. */
	error: string | null = $state(null);
	/** Progress fraction in $[0, 1]$ for the current phase. */
	progress: number = $state(0);
	/** Current build phase while status is `'computing'`; null otherwise. */
	phase: UnionGraphPhase | null = $state(null);
	/**
	 * The built union graph, or null. Raw state: the graph is immutable, and a
	 * cache hit re-assigns the same object, which must not look like a new one.
	 */
	graph: UnionGraph | null = $state.raw(null);

	/** FIFO cache keyed by the request's cache key. */
	private _cache = new Map<string, UnionGraph>();
	/** Monotonic request id; only the latest posted build's responses apply. */
	private _requestId = 0;
	/** Cache key of the latest posted build, until its result arrives. */
	private _pendingKey: string | null = null;
	/** Key the UI wants now (even when satisfied from cache). */
	private _desiredKey: string | null = null;
	/** Unregister function for the worker listener. */
	private _unregister: (() => void) | null = null;

	/**
	 * Request a union-graph build.
	 *
	 * Cache hits complete instantly. Misses post to the worker, which
	 * aborts any older build it is still running.
	 */
	request(opts: UnionGraphRequestOpts): void {
		if (!browser) return;

		const cached = this._cache.get(opts.key);
		if (cached) {
			// This key is what the UI wants now, so a build still running for
			// another key must not overwrite it when it finishes.
			this._desiredKey = opts.key;
			this.graph = cached;
			this.status = 'ready';
			this.error = null;
			this.progress = 1;
			this.phase = null;
			return;
		}

		if (opts.key === this._pendingKey) {
			// The same build is already running: keep it instead of restarting.
			this._desiredKey = opts.key;
			if (this.status !== 'computing') {
				this.status = 'computing';
				this.error = null;
				this.progress = 0;
				this.phase = null;
			}
			return;
		}

		this._start(opts);
	}

	private _start(opts: UnionGraphRequestOpts): void {
		this._pendingKey = opts.key;
		this._desiredKey = opts.key;
		this.status = 'computing';
		this.error = null;
		this.progress = 0;
		this.phase = null;

		// Register the worker listener once.
		if (!this._unregister) {
			this._unregister = trajectoryStore.onUnionMessage((msg) => this._handleWorkerMessage(msg));
		}

		const requestId = ++this._requestId;
		const msg: TrajectoryWorkerUnionGraphRequest = {
			kind: 'union-graph',
			requestId,
			tokenizerId: opts.tokenizerId,
			strategyId: opts.strategyId,
			strategyConfig: opts.strategyConfig,
			vocabSize: opts.vocabSize,
			rows: opts.rows.slice(), // the worker takes ownership of the copy
			T: opts.T,
			L: opts.L,
			limitMode: opts.limitMode,
			k: opts.k,
			p: opts.p,
		};
		trajectoryStore.postUnionGraph(msg);
	}

	/** Handle a union-graph worker message. */
	private _handleWorkerMessage(msg: TrajectoryWorkerResponse): void {
		if (msg.kind === 'union-graph-progress') {
			const p = msg as TrajectoryWorkerUnionGraphProgressResponse;
			// Ignore progress from superseded builds, and from a build the UI
			// no longer wants (a cache hit moved `_desiredKey` on).
			if (p.requestId !== this._requestId || this._pendingKey !== this._desiredKey) return;
			this.progress = p.total > 0 ? p.step / p.total : 1;
			this.phase = p.phase;
			return;
		}

		if (msg.kind === 'union-graph' || msg.kind === 'union-graph-error') {
			if (msg.requestId !== this._requestId) return; // superseded: drop
			const key = this._pendingKey;
			this._pendingKey = null;
			// Only apply the result if this build is still what the UI wants.
			const wanted = key !== null && key === this._desiredKey;

			if (msg.kind === 'union-graph') {
				if (key !== null) this.cacheUnderKey(key, msg.graph);
				if (wanted) {
					this.graph = msg.graph;
					this.status = 'ready';
					this.error = null;
					this.progress = 1;
					this.phase = null;
				}
			} else if (wanted) {
				this.status = 'error';
				this.error = msg.message;
				this.progress = 0;
				this.phase = null;
			}
		}
	}

	/**
	 * Cache a finished graph under a key with FIFO eviction.
	 */
	private cacheUnderKey(key: string, graph: UnionGraph): void {
		if (this._cache.has(key)) return;
		if (this._cache.size >= CACHE_MAX) {
			const first = this._cache.keys().next().value;
			if (first !== undefined) this._cache.delete(first);
		}
		this._cache.set(key, graph);
	}

	/** Drop all cached graphs (e.g. on seed or spec change). */
	clearCache(): void {
		this._cache.clear();
	}
}

export const graphStore = new GraphStore();
