import { describe, expect, it } from 'vitest';
import { verifyVocabSha, vocabCanonicalText, wordVocabSha } from './vocab-sha.js';

describe('vocab-sha', () => {
	it('canonicalizes the vocabulary as newline-joined UTF-8', () => {
		expect(vocabCanonicalText(['the', 'a'])).toBe('the\na');
		expect(vocabCanonicalText([])).toBe('');
		expect(vocabCanonicalText(['café'])).toBe('café');
	});

	it('hashes a known vocabulary (cross-checked with Python hashlib)', async () => {
		await expect(wordVocabSha(['the', 'a'])).resolves.toBe(
			'87b787d3d13453c5ad6b9e993b23b16ab8ce1303fa453ccae6d5cd0a3a7d449c',
		);
	});

	it('verifies a matching vocabSha', async () => {
		const sha = await wordVocabSha(['the', 'a']);
		await expect(
			verifyVocabSha({ source: 'gpt2', vocabSha: sha }, ['the', 'a']),
		).resolves.toBeUndefined();
	});

	it('rejects a mismatch, naming the source and both hashes', async () => {
		const wrong = await wordVocabSha(['a', 'the']);
		await expect(verifyVocabSha({ source: 'gpt2', vocabSha: wrong }, ['the', 'a'])).rejects.toThrow(
			`Embedding vocab SHA mismatch for "gpt2": expected ${wrong}, got ` +
				'87b787d3d13453c5ad6b9e993b23b16ab8ce1303fa453ccae6d5cd0a3a7d449c',
		);
	});

	it('is a no-op when the meta has no vocabSha', async () => {
		await expect(verifyVocabSha({ source: 'gpt2' }, ['anything'])).resolves.toBeUndefined();
	});
});
