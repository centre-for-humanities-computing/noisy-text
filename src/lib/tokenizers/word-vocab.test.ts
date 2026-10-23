import { describe, it, expect } from 'vitest';

import { parseWordVocab } from './word-vocab.js';

/** A minimal valid vocabulary object, cloned per test. */
function valid(): Record<string, unknown> {
	return {
		version: 1,
		source: 'test-fixture',
		license: 'CC0-1.0',
		words: ['b', 'a', 'c'],
		ranks: [1, 2, 0],
	};
}

function rejects(value: unknown, reason?: string): void {
	const expected = reason === undefined ? /^parseWordVocab: / : `parseWordVocab: ${reason}`;
	expect(() => parseWordVocab(value)).toThrow(expected);
}

describe('parseWordVocab', () => {
	it('orders words by ascending rank', () => {
		expect(parseWordVocab(valid())).toEqual(['c', 'b', 'a']);
	});

	it('does not mutate the input', () => {
		const input = valid();
		const before = JSON.stringify(input);
		parseWordVocab(input);
		expect(JSON.stringify(input)).toBe(before);
	});

	it('ignores unknown extra fields', () => {
		expect(parseWordVocab({ ...valid(), extra: true })).toEqual(['c', 'b', 'a']);
	});

	it('accepts a single-word vocabulary', () => {
		expect(parseWordVocab({ ...valid(), words: ['x'], ranks: [0] })).toEqual(['x']);
	});

	it('rejects non-objects and arrays', () => {
		rejects(null, 'expected a JSON object');
		rejects([], 'expected a JSON object');
		rejects('vocab', 'expected a JSON object');
		rejects(42, 'expected a JSON object');
		rejects(undefined, 'expected a JSON object');
	});

	it('rejects a missing or wrongly typed version', () => {
		const missing = valid();
		delete missing.version;
		rejects(missing, '"version" must be a finite number');
		rejects({ ...valid(), version: '1' }, '"version" must be a finite number');
		rejects({ ...valid(), version: Number.NaN }, '"version" must be a finite number');
	});

	it('rejects a missing or empty source', () => {
		const missing = valid();
		delete missing.source;
		rejects(missing, '"source" must be a non-empty string');
		rejects({ ...valid(), source: '' }, '"source" must be a non-empty string');
		rejects({ ...valid(), source: 0 }, '"source" must be a non-empty string');
	});

	it('rejects a missing or empty license', () => {
		const missing = valid();
		delete missing.license;
		rejects(missing, '"license" must be a non-empty string');
		rejects({ ...valid(), license: '' }, '"license" must be a non-empty string');
		rejects({ ...valid(), license: null }, '"license" must be a non-empty string');
	});

	it('rejects missing, empty or non-array words', () => {
		rejects({ ...valid(), words: [] });
		rejects({ ...valid(), words: 'abc' });
		rejects({ ...valid(), words: null });
	});

	it('rejects duplicate, empty, whitespace or non-string words', () => {
		rejects({ ...valid(), words: ['a', 'a'], ranks: [0, 1] });
		rejects({ ...valid(), words: ['a', ''], ranks: [0, 1] });
		rejects({ ...valid(), words: ['a', 'b c'], ranks: [0, 1] });
		rejects({ ...valid(), words: ['a', 'b\tc'], ranks: [0, 1] });
		rejects({ ...valid(), words: ['a', 7], ranks: [0, 1] });
	});

	it('rejects missing, non-integer, out-of-range or duplicate ranks', () => {
		rejects({ ...valid(), ranks: undefined });
		rejects({ ...valid(), ranks: [0, 1] });
		rejects({ ...valid(), ranks: [0, 1, 2, 3] });
		rejects({ ...valid(), ranks: [0, 1.5, 2] });
		rejects({ ...valid(), ranks: [0, 1, 3] });
		rejects({ ...valid(), ranks: [0, 1, -1] });
		rejects({ ...valid(), ranks: [0, 1, 1] });
	});
});
