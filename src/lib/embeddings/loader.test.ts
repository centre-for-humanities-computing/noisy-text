import { describe, expect, it } from 'vitest';
import {
	EMBEDDING_BASE_URL,
	EMBEDDING_CACHE_TAG,
	HF_DATASET_REPO,
	HF_DATASET_REVISION,
	hfResolvePrefix,
	shortHash,
} from './loader.js';

describe('shortHash', () => {
	it('is deterministic', () => {
		expect(shortHash('abc')).toBe(shortHash('abc'));
	});

	it('returns 8 lowercase hex chars', () => {
		for (const s of ['', 'a', 'hello', 'https://huggingface.co/datasets/x/resolve/y']) {
			expect(shortHash(s)).toMatch(/^[0-9a-f]{8}$/);
		}
	});

	it('is distinct for distinct inputs (sampled)', () => {
		const seen = new Map<string, string>();
		for (let i = 0; i < 200; i++) {
			const h = shortHash(`input-${i}`);
			const prev = seen.get(h);
			expect(prev).toBeUndefined();
			seen.set(h, `input-${i}`);
		}
	});
});

describe('hfResolvePrefix', () => {
	it('builds the HF dataset resolve URL', () => {
		expect(hfResolvePrefix('chcaa/noisy-text-embeddings', 'abc123')).toBe(
			'https://huggingface.co/datasets/chcaa/noisy-text-embeddings/resolve/abc123',
		);
	});
});

describe('default base URL + cache tag', () => {
	// Assumes the test environment leaves VITE_EMBEDDING_BASE_URL unset.
	it('EMBEDDING_BASE_URL is the HF resolve prefix for the pinned revision', () => {
		expect(EMBEDDING_BASE_URL).toBe(hfResolvePrefix(HF_DATASET_REPO, HF_DATASET_REVISION));
	});

	it('EMBEDDING_CACHE_TAG is shortHash of the base URL', () => {
		expect(EMBEDDING_CACHE_TAG).toBe(shortHash(EMBEDDING_BASE_URL));
	});
});
