import { describe, expect, it } from 'vitest';
import { hasIndexedDb, idbGet, idbPut } from './idb.js';

// Node test environment: no `indexedDB` global, so every call must take
// the guarded no-op path. Connection reuse itself is exercised in the
// browser (manual smoke test).
describe('idb node guard', () => {
	it('reports no IndexedDB under the node test environment', () => {
		expect(hasIndexedDb()).toBe(false);
	});

	it('idbGet resolves to undefined', async () => {
		await expect(idbGet('rows', 'k')).resolves.toBeUndefined();
	});

	it('idbPut resolves without error', async () => {
		await expect(idbPut('rows', 'k', { ids: [1], dists: [0.5] })).resolves.toBeUndefined();
	});
});
