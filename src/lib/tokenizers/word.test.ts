import { describe, it, expect } from 'vitest';

import { normalizeWordText } from './word.js';

describe('normalizeWordText', () => {
	it('converts CRLF and lone CR to LF', () => {
		expect(normalizeWordText('a\r\nb\rc')).toBe('a\nb\nc');
	});

	it('trims each line and collapses spaces and tabs', () => {
		expect(normalizeWordText('  hello \t  world\t ')).toBe('hello world');
		expect(normalizeWordText('\t a \t\t b \t')).toBe('a b');
	});

	it('preserves newlines, including blank lines', () => {
		expect(normalizeWordText('a\n\nb\n')).toBe('a\n\nb\n');
		expect(normalizeWordText('one\r\n\r\ntwo\r\n')).toBe('one\n\ntwo\n');
	});

	it('normalizes whitespace-only lines to empty lines', () => {
		expect(normalizeWordText('a\n \t \nb')).toBe('a\n\nb');
	});

	it('leaves already-normalized text unchanged', () => {
		const text = 'Hello, world!\nSecond line.';
		expect(normalizeWordText(text)).toBe(text);
	});
});
