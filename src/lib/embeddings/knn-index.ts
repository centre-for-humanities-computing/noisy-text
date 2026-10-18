import type { MetricId, PreprocessId, QuantizedMatrix, TransformBundle } from './types.js';
import { dequantizeRow } from './quantized-matrix.js';
import { applyPreprocess } from './preprocessing.js';
import { metricDistance } from './metric.js';

/**
 * Lazy kNN index over an int8-quantized embedding matrix.
 *
 * `topM(token)` scans all $K$ rows ($O(K \cdot d)$ with early
 * preprocessing reuse), keeping the $M$ nearest via a bounded max-heap;
 * results are memoized per token. Transformed rows are memoized in a
 * bounded map so repeated `distance(a, b)` queries and later `topM`
 * scans of nearby tokens reuse work.
 *
 * Neighbours are the top-$M$ by metric — a $k$NN graph — not everything
 * within a radius; self is always excluded.
 *
 * Optional IndexedDB persistence: a `RowCache` (see `idb.ts`), injected
 * by the worker, is consulted in `precomputeRows` under the key
 * `source|preprocess|metric|m|token`, so revisits skip the full scan.
 */

/** Serializable top-$M$ neighbour list for one token. */
export interface TopMTable {
	ids: Int32Array;
	dists: Float32Array;
}

/** Minimal async key-value interface (satisfied by the IndexedDB wrapper). */
export interface RowCache {
	get(key: string): Promise<unknown>;
	put(key: string, value: unknown): Promise<void>;
}

export interface EmbeddingKnnIndexOptions {
	/** Optional persistence backend for computed top-$M$ rows. */
	cache?: RowCache;
	/** Key prefix for cache entries (`source|preprocess|metric|m`). */
	cacheKeyPrefix?: string;
	/** Row-transform memo cap (default 4096 rows). */
	maxMemoizedRows?: number;
	/** Tokens processed per chunk in `precomputeRows`. Default 128. */
	chunkSize?: number;
}

export class EmbeddingKnnIndex {
	readonly matrix: QuantizedMatrix;
	readonly transform: TransformBundle;
	readonly preprocess: PreprocessId;
	readonly metric: MetricId;
	/** Number of neighbours kept per token. */
	readonly m: number;

	private readonly _cache: RowCache | null;
	private readonly _cachePrefix: string;
	private readonly _maxMemoizedRows: number;
	private readonly _chunkSize: number;

	/** token → top-$M$ table (bounded implicitly by usage; rows are small). */
	private _topM: Map<number, TopMTable> = new Map();
	/** token → transformed row (bounded by `_maxMemoizedRows`). */
	private _rows: Map<number, Float32Array> = new Map();
	/** Scratch dequantize buffer (dim-sized, reused). */
	private _deq: Float32Array;

	constructor(
		matrix: QuantizedMatrix,
		transform: TransformBundle,
		preprocess: PreprocessId,
		metric: MetricId,
		m: number,
		opts: EmbeddingKnnIndexOptions = {},
	) {
		if (!Number.isInteger(m) || m < 1) {
			throw new Error(`EmbeddingKnnIndex: m must be a positive integer, got ${m}`);
		}
		this.matrix = matrix;
		this.transform = transform;
		this.preprocess = preprocess;
		this.metric = metric;
		this.m = m;
		this._cache = opts.cache ?? null;
		this._cachePrefix = opts.cacheKeyPrefix ?? '';
		this._maxMemoizedRows = opts.maxMemoizedRows ?? 4096;
		this._chunkSize = opts.chunkSize ?? 128;
		this._deq = new Float32Array(matrix.dim);
	}

	/**
	 * Top-$M$ nearest neighbours of `token` (self excluded), ascending by
	 * distance. Memoized per token.
	 */
	topM(token: number): TopMTable {
		const cached = this._topM.get(token);
		if (cached) return cached;

		const { vocabSize: K } = this.matrix;
		const query = this._rowOf(token);

		// Bounded max-heap on distance: heap of (dist, id) pairs, root =
		// worst of the current best M.
		const heapIds = new Int32Array(this.m);
		const heapDists = new Float32Array(this.m);
		let size = 0;

		for (let j = 0; j < K; j++) {
			if (j === token) continue;
			const dist = metricDistance(query, this._rowOf(j), this.metric);
			if (size < this.m) {
				heapIds[size] = j;
				heapDists[size] = dist;
				this._siftUpMax(heapDists, heapIds, size);
				size++;
			} else if (dist < heapDists[0]!) {
				heapDists[0] = dist;
				heapIds[0] = j;
				this._siftDownMax(heapDists, heapIds, size);
			}
		}

		// Extract in ascending order by repeatedly swapping the root out.
		const ids = new Int32Array(size);
		const dists = new Float32Array(size);
		for (let i = size - 1; i >= 0; i--) {
			ids[i] = heapIds[0]!;
			dists[i] = heapDists[0]!;
			heapIds[0] = heapIds[i]!;
			heapDists[0] = heapDists[i]!;
			this._siftDownMax(heapDists, heapIds, i);
		}

		const table: TopMTable = { ids, dists };
		this._topM.set(token, table);
		return table;
	}

	/** Max-heap sift-down over `dists` carrying `ids`, heap size `n`. */
	private _siftDownMax(dists: Float32Array, ids: Int32Array, n: number): void {
		let i = 0;
		for (;;) {
			const l = 2 * i + 1;
			const r = l + 1;
			let largest = i;
			if (l < n && dists[l]! > dists[largest]!) largest = l;
			if (r < n && dists[r]! > dists[largest]!) largest = r;
			if (largest === i) return;
			const td = dists[i]!;
			dists[i] = dists[largest]!;
			dists[largest] = td;
			const ti = ids[i]!;
			ids[i] = ids[largest]!;
			ids[largest] = ti;
			i = largest;
		}
	}

	/** Sift the element at `start` up to restore the max-heap invariant. */
	private _siftUpMax(dists: Float32Array, ids: Int32Array, start: number): void {
		let i = start;
		while (i > 0) {
			const parent = (i - 1) >> 1;
			if (dists[i]! <= dists[parent]!) return;
			const td = dists[i]!;
			dists[i] = dists[parent]!;
			dists[parent] = td;
			const ti = ids[i]!;
			ids[i] = ids[parent]!;
			ids[parent] = ti;
			i = parent;
		}
	}

	/**
	 * Transformed embedding row of `token` (memoized). Dequantizes the
	 * int8 row and applies the preprocessing into a fresh buffer (memoized
	 * buffers are shared, so they must not be mutated by callers).
	 */
	private _rowOf(token: number): Float32Array {
		const memo = this._rows.get(token);
		if (memo) return memo;
		const { dim } = this.matrix;
		dequantizeRow(this.matrix, token, this._deq);
		const out = new Float32Array(dim);
		applyPreprocess(this._deq, out, this.preprocess, this.transform);
		if (this._rows.size >= this._maxMemoizedRows) {
			// Evict the oldest entry (FIFO) to bound memory.
			const first = this._rows.keys().next();
			if (!first.done) this._rows.delete(first.value);
		}
		this._rows.set(token, out);
		return out;
	}

	/** Metric distance between two tokens' transformed rows. */
	distance(a: number, b: number): number {
		return metricDistance(this._rowOf(a), this._rowOf(b), this.metric);
	}

	/**
	 * Chunked top-$M$ computation for a token set, yielding to the event
	 * loop between chunks so progress messages can be delivered. Consults
	 * the row cache (when present) before scanning and persists results.
	 *
	 * @returns Number of rows computed fresh (not served from cache).
	 */
	async precomputeRows(
		tokens: Int32Array,
		onProgress?: (done: number, total: number) => void,
	): Promise<number> {
		let computed = 0;
		const total = tokens.length;
		for (let offset = 0; offset < total; offset += this._chunkSize) {
			const end = Math.min(offset + this._chunkSize, total);
			for (let i = offset; i < end; i++) {
				const token = tokens[i]!;
				if (this._topM.has(token)) continue;
				const key = `${this._cachePrefix}|${token}`;
				if (this._cache) {
					const hit = (await this._cache.get(key)) as TopMTable | undefined | null;
					if (hit && hit.ids && hit.dists) {
						this._topM.set(token, { ids: hit.ids, dists: hit.dists });
						continue;
					}
				}
				const table = this.topM(token);
				computed++;
				if (this._cache) {
					await this._cache.put(key, table);
				}
			}
			onProgress?.(end, total);
			// Yield to the event loop.
			await new Promise((r) => setTimeout(r, 0));
		}
		return computed;
	}
}
