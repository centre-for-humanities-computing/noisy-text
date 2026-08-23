import type { LexicalNeighborTable } from '$lib/strategies/lexical-neighbors.js';

/**
 * IndexedDB wrapper for precomputed neighbor tables.
 *
 * Cache key: `(tokenizerId, maxDistance, k)`.
 *
 * Caches are explicit — never time-based. On top of IndexedDB, a small
 * in-memory L2 map avoids repeated IDB round-trips for the active session.
 */

const DB_NAME = 'noisy-text';
const DB_VERSION = 1;
const STORE_NAME = 'neighbor-tables';

/**
 * Compute the IndexedDB key for a neighbor table.
 */
export function neighborTableKey(tokenizerId: string, maxDistance: number, k: number): string {
	return [tokenizerId, maxDistance, k].join(':');
}

/**
 * Open (or create) the neighbor-tables object store in IndexedDB.
 */
function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE_NAME)) {
				db.createObjectStore(STORE_NAME);
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

/**
 * In-memory L2 cache for neighbor tables, keyed by the same key as IDB.
 */
const _memCache = new Map<string, LexicalNeighborTable>();

/**
 * Store a neighbor table in both IndexedDB and the in-memory L2 cache.
 */
export async function putNeighborTable(
	key: string,
	table: LexicalNeighborTable,
): Promise<void> {
	// Store in L2 first (fast).
	_memCache.set(key, table);

	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, 'readwrite');
		const store = tx.objectStore(STORE_NAME);
		// Clone the typed arrays for IDB storage (they may be transferred).
		store.put(
			{
				neighborIds: new Int32Array(table.neighborIds),
				offsets: new Int32Array(table.offsets),
				weights: new Float32Array(table.weights),
				K: table.K,
			},
			key,
		);
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}

/**
 * Look up a neighbor table from the L2 cache or IndexedDB.
 *
 * Returns `undefined` if not found.
 */
export async function getNeighborTable(key: string): Promise<LexicalNeighborTable | undefined> {
	// L2 hit.
	const mem = _memCache.get(key);
	if (mem) return mem;

	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, 'readonly');
		const store = tx.objectStore(STORE_NAME);
		const req = store.get(key);
		req.onsuccess = () => {
			const row = req.result as
				| { neighborIds: Int32Array; offsets: Int32Array; weights: Float32Array; K: number }
				| undefined;
			if (!row) {
				resolve(undefined);
				return;
			}
			const table: LexicalNeighborTable = {
				neighborIds: row.neighborIds,
				offsets: row.offsets,
				weights: row.weights,
				K: row.K,
			};
			_memCache.set(key, table);
			resolve(table);
		};
		req.onerror = () => reject(req.error);
	});
}

/**
 * Clear all cached neighbor tables (both L2 and IndexedDB).
 */
export async function clearNeighborCache(): Promise<void> {
	_memCache.clear();
	const db = await openDb();
	return new Promise((resolve, reject) => {
		const tx = db.transaction(STORE_NAME, 'readwrite');
		const store = tx.objectStore(STORE_NAME);
		store.clear();
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
}