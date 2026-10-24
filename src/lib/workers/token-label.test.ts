import { describe, it, expect } from 'vitest';
import { tokenLabel } from './token-label.js';
import type { Tokenizer } from '../tokenizers/types.js';

function makeTokenizer(vocabSize: number, oovTokens?: readonly string[]): Tokenizer {
	return {
		info: {
			id: 'test',
			label: 'Test',
			description: 'Test tokenizer',
			plainName: 'Test',
			gloss: 'Test',
			wordPiece: false,
			tooltip: { text: '' },
		},
		vocabSize,
		encode: () => ({ ids: new Int32Array(0), vocabSize }),
		decode: () => '',
		idsToTokens: (ids) => Array.from(ids, (id) => `tok${id}`),
		...(oovTokens ? { oovTokens } : {}),
	};
}

describe('tokenLabel', () => {
	const tok = makeTokenizer(3, ['<oov0>', '<oov1>', '<oov2>']);

	it('decodes a static id', () => {
		expect(tokenLabel(tok, 2, 5)).toBe('tok2');
	});

	it('uses the OOV table for ids past the static vocabulary', () => {
		expect(tokenLabel(tok, 4, 5, tok.oovTokens)).toBe('<oov1>');
	});

	it('prefers the mask sentinel over the OOV table', () => {
		expect(tokenLabel(tok, 5, 5, tok.oovTokens)).toBe('[MASK]');
	});

	it('falls back to #id for a missing OOV entry', () => {
		expect(tokenLabel(tok, 7, 8, tok.oovTokens)).toBe('#7');
	});

	it('falls back to #id for an HF tokenizer with no OOV table', () => {
		const hf = makeTokenizer(3);
		expect(tokenLabel(hf, 3, 4)).toBe('#3');
	});
});
