import { describe, it, expect } from 'vitest';
import { EMBEDDING_SOURCES, getEmbeddingSource } from './sources.js';

describe('EMBEDDING_SOURCES', () => {
	it('contains exactly the two supported sources (gpt2-lmhead removed)', () => {
		expect(Object.keys(EMBEDDING_SOURCES)).toEqual(['bert-base-uncased', 'gpt2']);
	});

	it('registers gpt2 with its tokenizer pairing and dimensions', () => {
		expect(getEmbeddingSource('gpt2')).toBe(EMBEDDING_SOURCES.gpt2);
		expect(EMBEDDING_SOURCES.gpt2?.tokenizerId).toBe('gpt2');
		expect(EMBEDDING_SOURCES.gpt2?.dim).toBe(768);
		expect(EMBEDDING_SOURCES.gpt2?.vocabSize).toBe(50257);
	});

	it('throws on unknown ids, including the removed gpt2-lmhead', () => {
		expect(() => getEmbeddingSource('gpt2-lmhead')).toThrow();
		expect(() => getEmbeddingSource('nope')).toThrow();
	});
});
