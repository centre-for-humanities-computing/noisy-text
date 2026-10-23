import { describe, it, expect } from 'vitest';
import seedrandom from 'seedrandom';

import { normalizeWordText, segmentWordText } from './word.js';

const LETTER = /\p{L}/u;

function isLetter(ch: string): boolean {
	return LETTER.test(ch);
}

function isJoiner(ch: string): boolean {
	return ch === "'" || ch === '’' || ch === '-';
}

/**
 * Naive reference: scan code points and grow a word from letters, allowing a
 * joiner only when the next code point is also a letter.
 */
function naiveSegment(normalized: string): string[] {
	const chars = Array.from(normalized);
	const out: string[] = [];
	let i = 0;
	while (i < chars.length) {
		const ch = chars[i]!;
		if (!isLetter(ch)) {
			out.push(ch);
			i++;
			continue;
		}
		let word = '';
		while (i < chars.length && isLetter(chars[i]!)) {
			word += chars[i]!;
			i++;
		}
		while (i + 1 < chars.length && isJoiner(chars[i]!) && isLetter(chars[i + 1]!)) {
			word += chars[i]!;
			i++;
			while (i < chars.length && isLetter(chars[i]!)) {
				word += chars[i]!;
				i++;
			}
		}
		out.push(word);
	}
	return out;
}

const FRAGMENTS = [
	'the',
	'quick',
	'brown',
	'fox',
	'jumps',
	'zorblat',
	'quuxify',
	'The',
	'London',
	'café',
	'naïve',
	'über',
	'well-known',
	"don't",
	"rock'n'roll",
	'.',
	',',
	';',
	':',
	'!',
	'?',
	'(',
	')',
	'[',
	']',
	'{',
	'}',
	'%',
	'…',
	'”',
	'’',
	'»',
	'›',
	'"',
	"'",
	'/',
	'_',
	'@',
	'#',
	'-',
	'—',
	' ',
	' ',
	'\t',
	'\n',
	'\r\n',
	'\r',
	'0',
	'42',
	'🙂',
	'👩‍🚀',
] as const;

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

describe('segmentWordText', () => {
	it('keeps contractions and hyphenated words whole', () => {
		expect(segmentWordText("don't")).toEqual(["don't"]);
		expect(segmentWordText('well-known')).toEqual(['well-known']);
		expect(segmentWordText("rock'n'roll")).toEqual(["rock'n'roll"]);
	});

	it('preserves capitalization and accents', () => {
		expect(segmentWordText('The Café Über')).toEqual(['The', ' ', 'Café', ' ', 'Über']);
	});

	it('splits punctuation into single tokens, including runs', () => {
		expect(segmentWordText('hi!!')).toEqual(['hi', '!', '!']);
		expect(segmentWordText('(a, b)')).toEqual(['(', 'a', ',', ' ', 'b', ')']);
	});

	it('keeps newlines as tokens', () => {
		expect(segmentWordText('a\nb')).toEqual(['a', '\n', 'b']);
	});

	it('emits digits one code point at a time', () => {
		expect(segmentWordText('42')).toEqual(['4', '2']);
	});

	it('does not split astral characters', () => {
		expect(segmentWordText('🙂')).toEqual(['🙂']);
		expect(segmentWordText('👩‍🚀')).toEqual(['👩', '\u200d', '🚀']);
	});

	it('treats leading and trailing joiners as standalone tokens', () => {
		expect(segmentWordText("'hello'")).toEqual(["'", 'hello', "'"]);
		expect(segmentWordText('-hello-')).toEqual(['-', 'hello', '-']);
		expect(segmentWordText("don''t")).toEqual(['don', "'", "'", 't']);
	});

	it('returns no tokens for an empty string', () => {
		expect(segmentWordText('')).toEqual([]);
	});

	it('is lossless: tokens concatenate back to the input', () => {
		const samples = ['a b', "don't stop\n!", '👩‍🚀 café 42', '  x\r\ny '];
		for (const sample of samples) {
			const normalized = normalizeWordText(sample);
			expect(segmentWordText(normalized).join('')).toBe(normalized);
		}
	});

	it('matches a naive reference on 500 generated strings', () => {
		const prng = seedrandom.alea('word-segment' + '\0');
		for (let caseIndex = 0; caseIndex < 500; caseIndex++) {
			const length = Math.floor(prng() * 26);
			let sample = '';
			for (let i = 0; i < length; i++) {
				const fragment = FRAGMENTS[Math.floor(prng() * FRAGMENTS.length)]!;
				sample += fragment;
			}
			const normalized = normalizeWordText(sample);
			const expected = naiveSegment(normalized);
			const actual = segmentWordText(normalized);
			expect(actual, `case ${caseIndex}: ${JSON.stringify(sample)}`).toEqual(expected);
			expect(actual.join(''), `lossless case ${caseIndex}`).toBe(normalized);
		}
	});
});
