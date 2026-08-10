import { describe, it, expect } from 'vitest';
import { TrajectoryCache, hashIds } from './trajectory-cache.js';
import type { Trajectory, TrajectorySpec } from './types.js';

function makeTrajectory(seed: number): Trajectory {
	const rows = new Int32Array([seed]);
	return {
		rows,
		T: 1,
		length: 1,
		seed,
		tokensAt(_t: number): Int32Array {
			return rows;
		},
	};
}

function makeSpec(overrides: Partial<TrajectorySpec> = {}): TrajectorySpec {
	return {
		inputIds: new Int32Array([1, 2, 3]),
		strategyId: 'identity',
		strategyConfig: {},
		scheduleId: 'linear',
		scheduleConfig: {},
		T: 100,
		vocabSize: 1000,
		seed: 42,
		...overrides,
	};
}

describe('hashIds', () => {
	it('returns a non-negative integer', () => {
		const h = hashIds(new Int32Array([1, 2, 3]));
		expect(Number.isInteger(h)).toBe(true);
		expect(h).toBeGreaterThanOrEqual(0);
	});

	it('is deterministic', () => {
		const ids = new Int32Array([42, 99, 7]);
		expect(hashIds(ids)).toBe(hashIds(ids));
	});

	it('differs for different inputs', () => {
		const a = hashIds(new Int32Array([1, 2, 3]));
		const b = hashIds(new Int32Array([1, 2, 4]));
		expect(a).not.toBe(b);
	});

	it('handles empty array', () => {
		const h = hashIds(new Int32Array(0));
		expect(h).toBe(2166136261); // FNV offset basis
	});
});

describe('TrajectoryCache', () => {
	it('starts empty', () => {
		const cache = new TrajectoryCache();
		expect(cache.size).toBe(0);
	});

	it('stores and retrieves by key', () => {
		const cache = new TrajectoryCache();
		const spec = makeSpec();
		const key = TrajectoryCache.key(spec, hashIds(spec.inputIds));
		const traj = makeTrajectory(42);
		cache.set(key, traj);
		expect(cache.size).toBe(1);
		expect(cache.get(key)).toBe(traj);
	});

	it('returns undefined on miss', () => {
		const cache = new TrajectoryCache();
		expect(cache.get('nonexistent')).toBeUndefined();
	});

	it('key varies with seed', () => {
		const spec1 = makeSpec({ seed: 1 });
		const spec2 = makeSpec({ seed: 2 });
		const k1 = TrajectoryCache.key(spec1, hashIds(spec1.inputIds));
		const k2 = TrajectoryCache.key(spec2, hashIds(spec2.inputIds));
		expect(k1).not.toBe(k2);
	});

	it('key varies with strategyId', () => {
		const spec1 = makeSpec({ strategyId: 'identity' });
		const spec2 = makeSpec({ strategyId: 'mask' });
		const k1 = TrajectoryCache.key(spec1, hashIds(spec1.inputIds));
		const k2 = TrajectoryCache.key(spec2, hashIds(spec2.inputIds));
		expect(k1).not.toBe(k2);
	});

	it('key varies with scheduleId', () => {
		const spec1 = makeSpec({ scheduleId: 'linear' });
		const spec2 = makeSpec({ scheduleId: 'cosine' });
		const k1 = TrajectoryCache.key(spec1, hashIds(spec1.inputIds));
		const k2 = TrajectoryCache.key(spec2, hashIds(spec2.inputIds));
		expect(k1).not.toBe(k2);
	});

	it('key varies with T', () => {
		const spec1 = makeSpec({ T: 100 });
		const spec2 = makeSpec({ T: 200 });
		const k1 = TrajectoryCache.key(spec1, hashIds(spec1.inputIds));
		const k2 = TrajectoryCache.key(spec2, hashIds(spec2.inputIds));
		expect(k1).not.toBe(k2);
	});

	it('key varies with input hash', () => {
		const spec = makeSpec();
		const k1 = TrajectoryCache.key(spec, hashIds(new Int32Array([1, 2, 3])));
		const k2 = TrajectoryCache.key(spec, hashIds(new Int32Array([4, 5, 6])));
		expect(k1).not.toBe(k2);
	});

	it('evicts oldest entry when full (FIFO)', () => {
		const cache = new TrajectoryCache();
		const MAX = 8; // matches MAX_CACHE_ENTRIES
		for (let i = 0; i < MAX + 2; i++) {
			const spec = makeSpec({ seed: i });
			const key = TrajectoryCache.key(spec, hashIds(spec.inputIds));
			cache.set(key, makeTrajectory(i));
		}
		expect(cache.size).toBe(MAX);
		// First two entries (seed 0, 1) should be evicted.
		const key0 = TrajectoryCache.key(makeSpec({ seed: 0 }), hashIds(makeSpec().inputIds));
		const key1 = TrajectoryCache.key(makeSpec({ seed: 1 }), hashIds(makeSpec().inputIds));
		const keyLast = TrajectoryCache.key(makeSpec({ seed: MAX + 1 }), hashIds(makeSpec().inputIds));
		expect(cache.get(key0)).toBeUndefined();
		expect(cache.get(key1)).toBeUndefined();
		expect(cache.get(keyLast)).toBeDefined();
	});

	it('clear empties the cache', () => {
		const cache = new TrajectoryCache();
		const spec = makeSpec();
		const key = TrajectoryCache.key(spec, hashIds(spec.inputIds));
		cache.set(key, makeTrajectory(42));
		expect(cache.size).toBe(1);
		cache.clear();
		expect(cache.size).toBe(0);
		expect(cache.get(key)).toBeUndefined();
	});

	it('re-inserting same key updates position (no duplicate eviction)', () => {
		const cache = new TrajectoryCache();
		const MAX = 8;
		// Fill cache.
		for (let i = 0; i < MAX; i++) {
			const spec = makeSpec({ seed: i });
			const key = TrajectoryCache.key(spec, hashIds(spec.inputIds));
			cache.set(key, makeTrajectory(i));
		}
		// Re-insert seed 0 — should move to end, not evict anything.
		const spec0 = makeSpec({ seed: 0 });
		const key0 = TrajectoryCache.key(spec0, hashIds(spec0.inputIds));
		cache.set(key0, makeTrajectory(999));
		expect(cache.size).toBe(MAX);
		expect(cache.get(key0)!.seed).toBe(999);
		// Now insert one more — seed 1 should be evicted (oldest), not seed 0.
		const specNew = makeSpec({ seed: MAX });
		const keyNew = TrajectoryCache.key(specNew, hashIds(specNew.inputIds));
		cache.set(keyNew, makeTrajectory(MAX));
		const key1 = TrajectoryCache.key(makeSpec({ seed: 1 }), hashIds(makeSpec().inputIds));
		expect(cache.get(key1)).toBeUndefined();
		expect(cache.get(key0)).toBeDefined();
	});
});
