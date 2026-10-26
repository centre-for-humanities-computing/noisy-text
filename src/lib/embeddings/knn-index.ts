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
 * For speed, `materialize()` builds a contiguous `Float32Array` of all $K$
 * transformed rows (plus `Float64Array` cosine norms) up front; while it
 * is present every scan reads it directly instead of dequantizing per
 * row. The matrix is in-memory only (never persisted to IndexedDB) and
 * subject to a byte budget: oversized configurations fall back to the
 * lazy path with identical results.
 *
 * Optional IndexedDB persistence: a `RowCache` (see `idb.ts`), injected
 * by the worker, is consulted in `precomputeRows` under the key
 * `source|preprocess|metric|m@<tag>|token`, so revisits skip the full
 * scan.
 *
 * Ids outside $[0, K)$ have no row in the matrix: per-input OOV words
 * are mapped beyond the static vocabulary. `topM` returns an empty
 * neighbour table for them (memoized), so `token-kernel.ts` turns the
 * empty row into the uniform floor $1/K_{\text{eff}}$ over the effective
 * vocabulary; `distance` returns $+\infty$ rather than reading memory or
 * producing NaN. `_rowOf` throws as a last-resort invariant — every
 * public entry point guards first.
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
	/** Key prefix for cache entries (`source|preprocess|metric|m@<tag>`). */
	cacheKeyPrefix?: string;
	/** Row-transform memo cap (default 4096 rows). */
	maxMemoizedRows?: number;
	/** Tokens processed per chunk in `precomputeRows`. Default 128. */
	chunkSize?: number;
	/** Max bytes for the materialized flat matrix; larger falls back to lazy. Default 256 MiB. */
	materializeBudgetBytes?: number;
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
	private readonly _materializeBudgetBytes: number;

	/** token → top-$M$ table (bounded implicitly by usage; rows are small). */
	private _topM: Map<number, TopMTable> = new Map();
	/** token → transformed row (bounded by `_maxMemoizedRows`). */
	private _rows: Map<number, Float32Array> = new Map();
	/** Scratch dequantize buffer (dim-sized, reused). */
	private _deq: Float32Array;

	/**
	 * Contiguous $K \cdot d$ transformed rows (`null` until `materialize`
	 * succeeds, and unset for over-budget matrices — the lazy path serves
	 * rows instead). Read-only views of this buffer back `_rowOf`.
	 */
	private _flat: Float32Array | null = null;
	/** Cosine-only squared norms, length $K$ (double precision: see `materialize`). */
	private _normSq: Float64Array | null = null;
	/** In-flight `materialize` call (memoization handle). */
	private _materializing: Promise<boolean> | null = null;
	/** Bounded max-heap scratch reused across `topM` calls (length $m$). */
	private readonly _heapIds: Int32Array;
	/** Bounded max-heap scratch reused across `topM` calls (length $m$). */
	private readonly _heapDists: Float32Array;

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
		this._materializeBudgetBytes = opts.materializeBudgetBytes ?? 256 * 1024 * 1024;
		this._deq = new Float32Array(matrix.dim);
		this._heapIds = new Int32Array(m);
		this._heapDists = new Float32Array(m);
	}

	/**
	 * Top-$M$ nearest neighbours of `token` (self excluded), ascending by
	 * distance. Memoized per token.
	 */
	topM(token: number): TopMTable {
		const cached = this._topM.get(token);
		if (cached) return cached;

		if (!this._inRange(token)) {
			// No row exists for OOV ids; the empty table makes the kernel
			// fall back to the uniform floor. Memoized so repeated OOV
			// lookups (precomputeRows) stay free.
			const empty: TopMTable = { ids: new Int32Array(0), dists: new Float32Array(0) };
			this._topM.set(token, empty);
			return empty;
		}

		const { vocabSize: K, dim } = this.matrix;
		const query = this._rowOf(token);
		const flat = this._flat;

		// Bounded max-heap on distance: heap of (dist, id) pairs, root =
		// worst of the current best M. Scratch buffers are class fields;
		// `ids`/`dists` below stay freshly allocated (they are memoized).
		const heapIds = this._heapIds;
		const heapDists = this._heapDists;
		let size = 0;

		if (flat && this.metric === 'cosine' && this._normSq) {
			// Fast cosine path over the flat matrix. The distance formula is
			// exactly `metricDistance`'s (no precomputed inverse norms) and
			// the norms/dot products accumulate in the same index order, so
			// results are bit-identical to the lazy path.
			const normSq = this._normSq;
			const nq = normSq[token]!;
			for (let j = 0; j < K; j++) {
				if (j === token) continue;
				let dot = 0;
				for (let k = 0; k < dim; k++) dot += query[k]! * flat[j * dim + k]!;
				const nj = normSq[j]!;
				const dist = nq === 0 || nj === 0 ? 1 : 1 - dot / (Math.sqrt(nq) * Math.sqrt(nj));
				size = this._offer(heapIds, heapDists, size, j, dist);
			}
		} else if (flat && this.metric === 'l2') {
			// Fast L2 path over the flat matrix (same accumulation order as
			// `metricDistance`).
			for (let j = 0; j < K; j++) {
				if (j === token) continue;
				let sum = 0;
				for (let k = 0; k < dim; k++) {
					const d = query[k]! - flat[j * dim + k]!;
					sum += d * d;
				}
				size = this._offer(heapIds, heapDists, size, j, Math.sqrt(sum));
			}
		} else {
			for (let j = 0; j < K; j++) {
				if (j === token) continue;
				const dist = metricDistance(query, this._rowOf(j), this.metric);
				size = this._offer(heapIds, heapDists, size, j, dist);
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

	/**
	 * Insert `(id, dist)` into the bounded max-heap if it beats the
	 * current worst of the best `m`; returns the new heap size. Identical
	 * logic to the previous inline `topM` block.
	 */
	private _offer(
		heapIds: Int32Array,
		heapDists: Float32Array,
		size: number,
		id: number,
		dist: number,
	): number {
		if (size < this.m) {
			heapIds[size] = id;
			heapDists[size] = dist;
			this._siftUpMax(heapDists, heapIds, size);
			return size + 1;
		}
		if (dist < heapDists[0]!) {
			heapDists[0] = dist;
			heapIds[0] = id;
			this._siftDownMax(heapDists, heapIds, size);
		}
		return size;
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
	 * Materialize the full transformed matrix into a contiguous
	 * `Float32Array` (plus `Float64Array` cosine norms), chunked and
	 * yielding so progress messages can be delivered.
	 *
	 * - Memoized: concurrent/repeat calls await the same promise.
	 * - Returns `false` (and does nothing) when $K \cdot d \cdot 4$
	 *   exceeds `materializeBudgetBytes` — the lazy path serves rows
	 *   instead, with identical results.
	 * - The norms are `Float64Array` on purpose: `metricDistance`
	 *   accumulates norms in doubles, and storing them in float32 would
	 *   perturb the last ulp and reorder near-ties.
	 *
	 * @returns Whether the flat matrix is available afterwards.
	 */
	async materialize(onProgress?: (done: number, total: number) => void): Promise<boolean> {
		if (this._flat) return true;
		if (this._materializing) return this._materializing;
		const { vocabSize: K, dim } = this.matrix;
		if (K * dim * 4 > this._materializeBudgetBytes) {
			this._materializing = Promise.resolve(false);
			return this._materializing;
		}
		this._materializing = (async () => {
			const flat = new Float32Array(K * dim);
			const normSq = this.metric === 'cosine' ? new Float64Array(K) : null;
			for (let offset = 0; offset < K; offset += this._chunkSize) {
				const end = Math.min(offset + this._chunkSize, K);
				for (let row = offset; row < end; row++) {
					dequantizeRow(this.matrix, row, this._deq);
					const out = flat.subarray(row * dim, (row + 1) * dim);
					applyPreprocess(this._deq, out, this.preprocess, this.transform);
					if (normSq) {
						// $\lVert v \rVert^2 = \sum_k v_k^2$, accumulated in the
						// same index order as `metricDistance`.
						let n = 0;
						for (let k = 0; k < dim; k++) {
							const v = out[k]!;
							n += v * v;
						}
						normSq[row] = n;
					}
				}
				onProgress?.(end, K);
				// Yield to the event loop.
				await new Promise((r) => setTimeout(r, 0));
			}
			this._normSq = normSq;
			this._flat = flat;
			return true;
		})();
		return this._materializing;
	}

	/**
	 * Transformed embedding row of `token` (memoized). With a materialized
	 * flat matrix this is a read-only view into it; otherwise the row is
	 * dequantized and preprocessed into a fresh buffer (memoized buffers
	 * are shared, so they must not be mutated by callers).
	 */
	private _rowOf(token: number): Float32Array {
		if (!this._inRange(token)) {
			throw new RangeError(
				`EmbeddingKnnIndex: token ${token} has no embedding row (K=${this.matrix.vocabSize})`,
			);
		}
		const flat = this._flat;
		if (flat) return flat.subarray(token * this.matrix.dim, (token + 1) * this.matrix.dim);
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

	/** Whether `id` addresses a matrix row ($0 \le id < K$). */
	private _inRange(id: number): boolean {
		return Number.isInteger(id) && id >= 0 && id < this.matrix.vocabSize;
	}

	/**
	 * Metric distance between two tokens' transformed rows. Ids without a
	 * row return $+\infty$ (never NaN), so callers can treat them as
	 * infinitely far rather than guarding at every site.
	 */
	distance(a: number, b: number): number {
		if (!this._inRange(a) || !this._inRange(b)) return Number.POSITIVE_INFINITY;
		return metricDistance(this._rowOf(a), this._rowOf(b), this.metric);
	}

	/**
	 * Chunked top-$M$ computation for a token set, yielding to the event
	 * loop between chunks so progress messages can be delivered. Consults
	 * the row cache (when present) before scanning and persists results.
	 *
	 * The optional `deadline` (a `performance.now()` timestamp) stops the
	 * loop at the next chunk boundary when it has passed — best-effort,
	 * so the worst-case overrun is one chunk. Rows already memoized are
	 * skipped without a scan but still report progress; when the deadline
	 * breaks early, no synthetic final `[total, total]` call is emitted.
	 *
	 * @returns Number of rows computed fresh (not served from cache).
	 */
	async precomputeRows(
		tokens: Int32Array,
		onProgress?: (done: number, total: number) => void,
		deadline?: number,
	): Promise<number> {
		let computed = 0;
		const total = tokens.length;
		for (let offset = 0; offset < total; offset += this._chunkSize) {
			const end = Math.min(offset + this._chunkSize, total);
			if (deadline !== undefined && performance.now() >= deadline) break;
			for (let i = offset; i < end; i++) {
				const token = tokens[i]!;
				if (this._topM.has(token)) {
					onProgress?.(i + 1, total);
					continue;
				}
				const key = `${this._cachePrefix}|${token}`;
				if (this._cache) {
					const hit = (await this._cache.get(key)) as TopMTable | undefined | null;
					if (hit && hit.ids && hit.dists) {
						this._topM.set(token, { ids: hit.ids, dists: hit.dists });
						onProgress?.(i + 1, total);
						continue;
					}
				}
				const table = this.topM(token);
				computed++;
				if (this._cache) {
					await this._cache.put(key, table);
				}
				onProgress?.(i + 1, total);
			}
			// Yield to the event loop.
			await new Promise((r) => setTimeout(r, 0));
		}
		return computed;
	}
}
