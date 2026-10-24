import { describe, it, expect } from 'vitest';
import { TOKENIZERS, loadTokenizer } from './registry.js';

describe('tokenizer registry', () => {
	it('contains at least three tokenizers', () => {
		const ids = Object.keys(TOKENIZERS);
		expect(ids.length).toBeGreaterThanOrEqual(3);
	});

	it('every entry has the required shape', () => {
		for (const [id, info] of Object.entries(TOKENIZERS)) {
			expect(info.id).toBe(id);
			expect(typeof info.label).toBe('string');
			expect(info.label.length).toBeGreaterThan(0);
			expect(typeof info.description).toBe('string');
			expect(info.description.length).toBeGreaterThan(0);
			expect(typeof info.wordPiece).toBe('boolean');
			expect(info.plainName.length).toBeGreaterThan(0);
			expect(info.gloss.length).toBeGreaterThan(0);
			expect(info.tooltip.text.length).toBeGreaterThan(0);
		}
		expect(TOKENIZERS.gpt2?.wordPiece).toBe(false);
		expect(TOKENIZERS['bert-base-uncased']?.wordPiece).toBe(true);
	});

	it('describes the hosted word tokenizer', () => {
		const words = TOKENIZERS.words;
		expect(words).toBeDefined();
		expect(words?.id).toBe('words');
		expect(words?.label).toBe('Word vocabulary (50k)');
		expect(words?.wordPiece).toBe(false);
		expect(words?.plainName.length).toBeGreaterThan(0);
		expect(words?.gloss.length).toBeGreaterThan(0);
		expect(words?.tooltip.text.length).toBeGreaterThan(0);
		expect(words?.tooltip.math).toContain('50{,}000');
	});

	it('ids are unique', () => {
		const ids = Object.keys(TOKENIZERS);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('throws for an unknown id', async () => {
		await expect(loadTokenizer('nope')).rejects.toThrow(/Unknown tokenizer "nope"/);
	});
});
