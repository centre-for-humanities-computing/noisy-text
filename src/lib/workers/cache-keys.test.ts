import { describe, it, expect } from 'vitest';
import { providerCacheKey } from './cache-keys.js';

describe('providerCacheKey', () => {
	it('differs for same-length OOV tables with different content', () => {
		const a = providerCacheKey('edit-distance', 'words', [' ', 'zorblax']);
		const b = providerCacheKey('edit-distance', 'words', ['\n', 'zorblax']);
		expect(a).not.toBe(b);
	});

	it('is stable for the same inputs', () => {
		const a = providerCacheKey('char-overlap-set', 'words', [' ', 'zorblax']);
		const b = providerCacheKey('char-overlap-set', 'words', [' ', 'zorblax']);
		expect(a).toBe(b);
	});
});
