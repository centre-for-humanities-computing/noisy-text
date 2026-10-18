import { describe, expect, it } from 'vitest';
import {
	classifyTokens,
	buildTokenPredicate,
	predicateSignature,
	TOKEN_FLAG,
} from './embedding-filter.js';

describe('classifyTokens', () => {
	it('classifies representative GPT-2 strings', () => {
		// 'Ġword' = word-initial, 'piece' = continuation, byte-fallback, special.
		const masks = classifyTokens(['Ġthe', 'ing', '<0x4F>', '<|endoftext|>'], 'gpt2');
		expect(masks[0]! & TOKEN_FLAG.WORD_INITIAL).toBeTruthy();
		expect(masks[0]! & TOKEN_FLAG.CONTINUATION).toBeFalsy();
		expect(masks[1]! & TOKEN_FLAG.CONTINUATION).toBeTruthy();
		expect(masks[1]! & TOKEN_FLAG.WORD_INITIAL).toBeFalsy();
		expect(masks[2]! & TOKEN_FLAG.BYTE_FALLBACK).toBeTruthy();
		expect(masks[3]! & TOKEN_FLAG.SPECIAL).toBeTruthy();
	});

	it('classifies representative BERT strings', () => {
		const masks = classifyTokens(['play', '##ing', '[unused5]', '[CLS]'], 'bert-base-uncased');
		expect(masks[0]! & TOKEN_FLAG.WORD_INITIAL).toBeTruthy();
		expect(masks[1]! & TOKEN_FLAG.CONTINUATION).toBeTruthy();
		expect(masks[2]! & TOKEN_FLAG.UNUSED).toBeTruthy();
		expect(masks[3]! & TOKEN_FLAG.SPECIAL).toBeTruthy();
	});
});

describe('buildTokenPredicate', () => {
	const classes = classifyTokens(['Ġthe', 'ing', '<0x4F>', '[CLS]', '[unused5]'], 'gpt2');

	const base = {
		tokenClass: 'any',
		excludeSpecial: false,
		excludeUnused: false,
		excludeByteFallback: false,
	} as const;

	it("'any' with no exclusions admits everything", () => {
		const p = buildTokenPredicate(classes, base);
		expect([0, 1, 2, 3, 4].every((i) => p(i))).toBe(true);
	});

	it('each exclusion toggles membership', () => {
		expect(buildTokenPredicate(classes, { ...base, excludeByteFallback: true })(2)).toBe(false);
		expect(buildTokenPredicate(classes, { ...base, excludeSpecial: true })(3)).toBe(false);
		expect(buildTokenPredicate(classes, { ...base, excludeUnused: true })(4)).toBe(false);
		// The excluded token classes don't leak into other exclusions.
		expect(buildTokenPredicate(classes, { ...base, excludeSpecial: true })(2)).toBe(true);
	});

	it('token-class filters select by mask', () => {
		const wi = buildTokenPredicate(classes, { ...base, tokenClass: 'word-initial' });
		const cont = buildTokenPredicate(classes, { ...base, tokenClass: 'continuation' });
		expect(wi(0)).toBe(true);
		expect(wi(1)).toBe(false);
		expect(cont(1)).toBe(true);
		expect(cont(0)).toBe(false);
		// Byte-fallback token is neither word-initial nor continuation.
		expect(wi(2)).toBe(false);
		expect(cont(2)).toBe(false);
	});
});

describe('predicateSignature', () => {
	it('is unchanged by non-predicate fields (R1-N2)', () => {
		const a = {
			tokenClass: 'any',
			excludeSpecial: true,
			excludeUnused: false,
			excludeByteFallback: true,
		} as const;
		const withNoise = {
			...a,
			k: 99,
			tau: 3.5,
			epsilon: 0.01,
			family: 'power-law',
			maxDistance: 7,
		};
		expect(predicateSignature(withNoise)).toBe(predicateSignature(a));
	});

	it('changes when a predicate-shaping field changes', () => {
		const base = {
			tokenClass: 'any',
			excludeSpecial: true,
			excludeUnused: true,
			excludeByteFallback: true,
		} as const;
		const signatures = new Set<string>([predicateSignature(base)]);
		for (const variant of [
			{ ...base, tokenClass: 'word-initial' },
			{ ...base, excludeSpecial: false },
			{ ...base, excludeUnused: false },
			{ ...base, excludeByteFallback: false },
		] as const) {
			expect(predicateSignature(variant)).not.toBe(predicateSignature(base));
			signatures.add(predicateSignature(variant));
		}
		expect(signatures.size).toBe(5);
	});
});
