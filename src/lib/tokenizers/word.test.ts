import { describe, it, expect } from 'vitest';
import seedrandom from 'seedrandom';

import { createWordTokenizer, normalizeWordText, segmentWordText } from './word.js';
import type { TokenizerInfo } from './types.js';

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

const INFO: TokenizerInfo = {
	id: 'test-word',
	label: 'Test word',
	description: 'Word-level test tokenizer.',
	plainName: 'test words',
	gloss: 'Splits on words.',
	wordPiece: false,
	tooltip: { text: 'Test tokenizer.' },
};

describe('createWordTokenizer', () => {
	it('rejects an empty vocabulary and duplicates', () => {
		expect(() => createWordTokenizer(INFO, [])).toThrow(/vocabulary must not be empty/);
		expect(() => createWordTokenizer(INFO, ['a', 'b', 'a'])).toThrow(/duplicate word "a"/);
	});

	it('rejects empty static words', () => {
		expect(() => createWordTokenizer(INFO, [''])).toThrow(/word at index 0 must not be empty/);
		expect(() => createWordTokenizer(INFO, ['a', ''])).toThrow(/word at index 1 must not be empty/);
	});

	it('assigns static ids and grows the effective size with distinct OOV tokens', () => {
		const t = createWordTokenizer(INFO, ['hello', 'world']);
		const staticOnly = t.encode('hello');
		expect(Array.from(staticOnly.ids)).toEqual([0]);
		expect(staticOnly.vocabSize).toBe(2);
		expect(t.encode('hello').vocabSize).toBe(2);

		const withOov = t.encode('hello there');
		// hello, space, there → static 0, OOV 2, OOV 3.
		expect(Array.from(withOov.ids)).toEqual([0, 2, 3]);
		expect(withOov.vocabSize).toBe(4);
		expect(t.idsToTokens(withOov.ids)).toEqual(['hello', ' ', 'there']);

		// Existing OOV ids are reused, not reallocated.
		const again = t.encode('there hello');
		expect(Array.from(again.ids)).toEqual([3, 2, 0]);
		expect(again.vocabSize).toBe(4);
	});

	it('returns an empty token and skips unknown ids', () => {
		const t = createWordTokenizer(INFO, ['hello']);
		expect(t.idsToTokens(Int32Array.from([99]))).toEqual(['']);
		expect(t.decode(Int32Array.from([0, 99]))).toBe('hello');
		expect(t.decode(new Int32Array(0))).toBe('');
	});

	it('round-trips multi-paragraph prose (AC1)', () => {
		const t = createWordTokenizer(INFO, ['the', 'fox', 'she', 'said']);
		const prose = [
			'The Quick Brown Fox jumps over the lazy dog.',
			'',
			'“Don’t stop,” she said. “Well-known advice, isn’t it?”',
			'Café Über — naïve.',
		].join('\r\n');
		const encoded = t.encode(prose);
		expect(t.decode(encoded.ids)).toBe(normalizeWordText(prose));
	});

	it('pins the documented round-trip limits for adjacent marks', () => {
		const t = createWordTokenizer(INFO, ['the']);
		const cases = [
			['’tis', '’ tis'],
			['a,b', 'a, b'],
			['a(b', 'a (b'],
		] as const;
		for (const [input, decoded] of cases) {
			expect(t.decode(t.encode(input).ids)).toBe(decoded);
			expect(t.decode(t.encode(input).ids)).not.toBe(normalizeWordText(input));
		}
		expect(t.decode(t.encode('a, b').ids)).toBe('a, b');
	});

	it('round-trips and reuses OOV words (AC2)', () => {
		const t = createWordTokenizer(INFO, ['the']);
		const text = 'Zorblat Café well-known';
		const first = t.encode(text);
		expect(t.idsToTokens(first.ids)).toEqual(['Zorblat', ' ', 'Café', ' ', 'well-known']);
		expect(t.decode(first.ids)).toBe(text);

		const second = t.encode(text);
		expect(Array.from(second.ids)).toEqual(Array.from(first.ids));
		expect(second.vocabSize).toBe(first.vocabSize);
	});

	it('keeps every token verbatim and in order in the whole decode (AC4)', () => {
		const t = createWordTokenizer(INFO, ['hello', 'world']);
		const ids = t.encode('Hello, world!\n“Well-known” café.').ids;
		const whole = t.decode(ids);
		let cursor = 0;
		for (let i = 0; i < ids.length; i++) {
			const piece = t.decode(ids.subarray(i, i + 1));
			expect(piece.length, `token ${i} is empty`).toBeGreaterThan(0);
			const at = whole.indexOf(piece, cursor);
			expect(
				at,
				`token ${i} ${JSON.stringify(piece)} in ${JSON.stringify(whole)}`,
			).toBeGreaterThanOrEqual(cursor);
			cursor = at + piece.length;
		}
	});

	it('decodes every punctuation mark against a literal expectation', () => {
		const t = createWordTokenizer(INFO, ['word']);
		// Closing marks attach to the preceding word.
		const closing = [
			'word.',
			'word,',
			'word;',
			'word:',
			'word!',
			'word?',
			'word)',
			'word]',
			'word}',
			'word%',
			'word…',
			'word”',
			'word’',
			'word»',
			'word›',
			"word'",
			'word"',
		];
		// Opening marks attach to the following word.
		const opening = [
			'(word',
			'[word',
			'{word',
			'“word',
			'‘word',
			'«word',
			'‹word',
			"'word",
			'"word',
		];
		for (const text of [...closing, ...opening]) {
			expect(t.decode(t.encode(text).ids), text).toBe(text);
		}
	});

	it('matches a naive OOV allocator on 500 generated strings (AC3)', () => {
		const words = ['the', 'quick', 'brown', 'fox', 'jumps', 'well-known', 'café', "don't"];
		const t = createWordTokenizer(INFO, words);
		const staticIds = new Map(words.map((word, id) => [word, id]));
		const naiveOov = new Map<string, number>();
		const naiveOovTokens: string[] = [];
		const prng = seedrandom.alea('word-oov' + '\0');

		for (let caseIndex = 0; caseIndex < 500; caseIndex++) {
			const length = Math.floor(prng() * 26);
			let sample = '';
			for (let i = 0; i < length; i++) {
				sample += FRAGMENTS[Math.floor(prng() * FRAGMENTS.length)]!;
			}

			const expectedIds = segmentWordText(normalizeWordText(sample)).map((token) => {
				const staticId = staticIds.get(token);
				if (staticId !== undefined) return staticId;
				let id = naiveOov.get(token);
				if (id === undefined) {
					id = words.length + naiveOovTokens.length;
					naiveOov.set(token, id);
					naiveOovTokens.push(token);
				}
				return id;
			});

			const encoded = t.encode(sample);
			expect(Array.from(encoded.ids), `case ${caseIndex}: ${JSON.stringify(sample)}`).toEqual(
				expectedIds,
			);
			expect(encoded.vocabSize).toBe(words.length + naiveOovTokens.length);
			expect(t.decode(encoded.ids), `decode case ${caseIndex}`).toBe(
				naiveDecode(expectedIds, words, naiveOovTokens),
			);
		}
	});
});

/** Independent decode reference for the differential test. */
function naiveDecode(
	ids: number[],
	words: readonly string[],
	oovTokens: readonly string[],
): string {
	const closing = new Set([
		'.',
		',',
		';',
		':',
		'!',
		'?',
		')',
		']',
		'}',
		'%',
		'…',
		'”',
		'’',
		'»',
		'›',
		"'",
		'"',
	]);
	const opening = new Set(['(', '[', '{', '“', '‘', '«', '‹', "'", '"']);
	let out = '';
	for (let i = 0; i < ids.length; i++) {
		const id = ids[i]!;
		const token = id < words.length ? words[id]! : oovTokens[id - words.length]!;
		if (i > 0) {
			const prev = ids[i - 1]!;
			const prevToken = prev < words.length ? words[prev]! : oovTokens[prev - words.length]!;
			const attached =
				prevToken === ' ' ||
				prevToken === '\n' ||
				token === ' ' ||
				token === '\n' ||
				closing.has(token) ||
				opening.has(prevToken);
			if (!attached) out += ' ';
		}
		out += token;
	}
	return out;
}
