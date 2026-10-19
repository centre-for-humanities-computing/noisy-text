/**
 * Minimal promise wrapper over raw `indexedDB` — no dependency.
 *
 * DB `noisy-text-embeddings` with two object stores:
 * - `matrices`, keyed by `<source>@<EMBEDDING_CACHE_TAG>` — fetched
 *   embedding bundles.
 * - `rows`, keyed by
 *   `<source>|<preprocess>|<metric>|<m>@<EMBEDDING_CACHE_TAG>|<token>` —
 *   computed top-$M$ neighbour rows.
 *
 * The `IDBDatabase` connection is opened once and reused across calls
 * (with the cached handle dropped on `close`/`versionchange` so a lost
 * connection reopens on demand). Every call guards
 * `typeof indexedDB === 'undefined'` (node test environment, SSR) and
 * behaves as a cache miss / no-op there.
 */

import type { RowCache } from './knn-index.js';

const DB_NAME = 'noisy-text-embeddings';
const DB_VERSION = 1;
const MATRIX_STORE = 'matrices';
const ROW_STORE = 'rows';

/** Whether IndexedDB is available in this environment. */
export function hasIndexedDb(): boolean {
	return typeof indexedDB !== 'undefined';
}

/** Cached connection promise; `null` once dropped or before the first use. */
let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Open the database once and reuse the handle. The memo is dropped on
 * `close`/`versionchange` (and on open failure) so the next call reopens.
 */
function openDb(): Promise<IDBDatabase> {
	if (!dbPromise) {
		dbPromise = new Promise((resolve, reject) => {
			const req = indexedDB.open(DB_NAME, DB_VERSION);
			req.onupgradeneeded = () => {
				const db = req.result;
				if (!db.objectStoreNames.contains(MATRIX_STORE)) db.createObjectStore(MATRIX_STORE);
				if (!db.objectStoreNames.contains(ROW_STORE)) db.createObjectStore(ROW_STORE);
			};
			req.onsuccess = () => {
				const db = req.result;
				db.onclose = () => {
					dbPromise = null;
				};
				db.onversionchange = () => {
					db.close();
					dbPromise = null;
				};
				resolve(db);
			};
			req.onerror = () => {
				dbPromise = null;
				reject(req.error ?? new Error('indexedDB.open failed'));
			};
		});
	}
	return dbPromise;
}

/** Get a value from an object store; `undefined` on miss or when IDB is unavailable. */
export async function idbGet<T = unknown>(store: string, key: string): Promise<T | undefined> {
	if (!hasIndexedDb()) return undefined;
	try {
		const db = await openDb();
		return await new Promise<T | undefined>((resolve, reject) => {
			const tx = db.transaction(store, 'readonly');
			const req = tx.objectStore(store).get(key);
			req.onsuccess = () => resolve(req.result as T | undefined);
			req.onerror = () => reject(req.error ?? new Error('idbGet failed'));
		});
	} catch (e: unknown) {
		// A failed cache read must never break loading; report and miss.
		console.warn('IndexedDB read failed:', e instanceof Error ? e.message : e);
		return undefined;
	}
}

/** Put a value into an object store; a no-op when IDB is unavailable or the write fails. */
export async function idbPut(store: string, key: string, value: unknown): Promise<void> {
	if (!hasIndexedDb()) return;
	try {
		const db = await openDb();
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction(store, 'readwrite');
			tx.objectStore(store).put(value, key);
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error ?? new Error('idbPut failed'));
		});
	} catch (e: unknown) {
		console.warn('IndexedDB write failed:', e instanceof Error ? e.message : e);
	}
}

/** `RowCache` backed by the `rows` object store (no-op without IDB). */
export const idbRowCache: RowCache = {
	get: (key) => idbGet(ROW_STORE, key),
	put: (key, value) => idbPut(ROW_STORE, key, value),
};
