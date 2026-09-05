import type { Trajectory, TrajectorySpec } from './types.js';

/**
 * Maximum number of cached trajectories before eviction.
 * FIFO eviction: when the cache is full, the oldest entry is removed.
 */
const MAX_CACHE_ENTRIES = 8;

/**
 * In-memory LRU-ish cache for trajectories, keyed by
 * `(inputHash, strategyId, strategyConfig, scheduleId, scheduleConfig, T, seed)`.
 *
 * Cache invalidation is explicit (never time-based), per CONVENTIONS.
 */
export class TrajectoryCache {
	private _map = new Map<string, Trajectory>();
	private _keys: string[] = []; // insertion order for FIFO eviction

	/**
	 * Compute a cache key from a trajectory spec and input hash.
	 *
	 * Key format: `${tokenizerId}:${inputHash}:${strategyId}:${strategyConfigJson}:${scheduleId}:${scheduleConfigJson}:${T}:${seed}`
	 */
	static key(spec: TrajectorySpec, inputHash: number): string {
		return [
			spec.tokenizerId,
			inputHash,
			spec.strategyId,
			JSON.stringify(spec.strategyConfig),
			spec.scheduleId,
			JSON.stringify(spec.scheduleConfig),
			spec.T,
			spec.seed,
		].join(':');
	}

	/** Look up a cached trajectory. Returns `undefined` on miss. */
	get(key: string): Trajectory | undefined {
		return this._map.get(key);
	}

	/** Store a trajectory in the cache. Evicts oldest entry if full. */
	set(key: string, trajectory: Trajectory): void {
		if (this._map.has(key)) {
			// Update: remove old position, re-insert at end.
			this._keys = this._keys.filter((k) => k !== key);
		} else if (this._keys.length >= MAX_CACHE_ENTRIES) {
			// Evict oldest.
			const oldest = this._keys.shift()!;
			this._map.delete(oldest);
		}
		this._keys.push(key);
		this._map.set(key, trajectory);
	}

	/** Remove all cached entries. */
	clear(): void {
		this._map.clear();
		this._keys = [];
	}

	/** Number of cached entries. */
	get size(): number {
		return this._map.size;
	}
}

/**
 * FNV-1a 32-bit hash of an `Int32Array`.
 *
 * Deterministic, fast, and suitable for cache-key hashing of token
 * sequences. Not cryptographically secure.
 */
export function hashIds(ids: Int32Array): number {
	let hash = 2166136261;
	for (let i = 0; i < ids.length; i++) {
		hash ^= ids[i]!;
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}
