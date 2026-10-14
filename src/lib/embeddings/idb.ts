/**
 * Minimal promise wrapper over raw `indexedDB` — no dependency.
 *
 * DB `noisy-text-embeddings` with two object stores:
 * - `matrices`, keyed by `source` — fetched embedding bundles.
 * - `rows`, keyed by `source|preprocess|metric|m|token` — computed
 *   top-$M$ neighbour rows.
 *
 * Every call guards `typeof indexedDB === 'undefined'` (node test
 * environment, SSR) and behaves as a cache miss / no-op there.
 */

const DB_NAME = 'noisy-text-embeddings';
const DB_VERSION = 1;
const MATRIX_STORE = 'matrices';
const ROW_STORE = 'rows';

/** Whether IndexedDB is available in this environment. */
export function hasIndexedDb(): boolean {
	return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(MATRIX_STORE)) db.createObjectStore(MATRIX_STORE);
			if (!db.objectStoreNames.contains(ROW_STORE)) db.createObjectStore(ROW_STORE);
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error ?? new Error('indexedDB.open failed'));
	});
}

/** Get a value from an object store; `undefined` on miss or when IDB is unavailable. */
export async function idbGet<T = unknown>(store: string, key: string): Promise<T | undefined> {
	if (!hasIndexedDb()) return undefined;
	try {
		const db = await openDb();
		try {
			return await new Promise<T | undefined>((resolve, reject) => {
				const tx = db.transaction(store, 'readonly');
				const req = tx.objectStore(store).get(key);
				req.onsuccess = () => resolve(req.result as T | undefined);
				req.onerror = () => reject(req.error ?? new Error('idbGet failed'));
			});
		} finally {
			db.close();
		}
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
		try {
			await new Promise<void>((resolve, reject) => {
				const tx = db.transaction(store, 'readwrite');
				tx.objectStore(store).put(value, key);
				tx.oncomplete = () => resolve();
				tx.onerror = () => reject(tx.error ?? new Error('idbPut failed'));
			});
		} finally {
			db.close();
		}
	} catch (e: unknown) {
		console.warn('IndexedDB write failed:', e instanceof Error ? e.message : e);
	}
}
