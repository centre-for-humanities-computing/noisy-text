/**
 * Pure word-level normalization and segmentation.
 *
 * A "word" is a maximal run of Unicode letters (category `L`) that may be
 * joined by internal apostrophes or hyphens:
 * $w = L^{+}(\,[’'\-]\,L^{+})^{*}$. Everything else is emitted one Unicode
 * code point at a time, so punctuation, digits, emoji and newlines all become
 * their own tokens and no character is dropped.
 */

import type { EncodedText, Tokenizer, TokenizerInfo } from './types.js';

/** Matches one word: letters, optionally joined by `'`, `’` or `-`. */
const WORD_PATTERN = /[\p{L}]+(?:['’-][\p{L}]+)*/gu;

/** Matches a run of spaces and tabs, used to collapse horizontal whitespace. */
const HORIZONTAL_SPACE_PATTERN = /[ \t]+/gu;

/** Strip one collapsed leading or trailing space from a line. */
const LINE_EDGE_PATTERN = /^ | $/gu;

/**
 * Normalize prose before segmenting it.
 *
 * - `\r\n` and lone `\r` become `\n`.
 * - Each line is trimmed of leading/trailing spaces and tabs.
 * - Internal runs of spaces and tabs collapse to a single space.
 * - Every `\n` is preserved, including blank lines.
 */
export function normalizeWordText(text: string): string {
	return text
		.replace(/\r\n?/gu, '\n')
		.split('\n')
		.map((line) => line.replace(HORIZONTAL_SPACE_PATTERN, ' ').replace(LINE_EDGE_PATTERN, ''))
		.join('\n');
}

/**
 * Split normalized text into word and non-word tokens.
 *
 * Words are matched verbatim (case preserved, internal joiners kept). Every
 * other code point in the gaps becomes its own token, including `\n`; astral
 * characters are never split because the gap is iterated with `Array.from`.
 * The cursor guarantees that the concatenation of the tokens is exactly the
 * input.
 */
export function segmentWordText(normalized: string): string[] {
	const tokens: string[] = [];
	// A fresh regex per call so matchAll never inherits lastIndex state.
	const re = new RegExp(WORD_PATTERN.source, 'gu');
	let cursor = 0;

	for (const match of normalized.matchAll(re)) {
		const index = match.index;
		for (const ch of Array.from(normalized.slice(cursor, index))) {
			tokens.push(ch);
		}
		tokens.push(match[0]);
		cursor = index + match[0].length;
	}

	for (const ch of Array.from(normalized.slice(cursor))) {
		tokens.push(ch);
	}
	return tokens;
}

/** Tokens that attach to the preceding token on decode. */
const CLOSING_PUNCTUATION = new Set([
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

/** Tokens that attach to the following token on decode. */
const OPENING_PUNCTUATION = new Set(['(', '[', '{', '“', '‘', '«', '‹', "'", '"']);

/**
 * Create a word-level tokenizer over a static vocabulary.
 *
 * Static ids are $0 \ldots K-1$ with $K = \text{words.length}$. Any token not
 * in the static vocabulary gets a per-instance, append-only id in first-seen
 * order starting at $K$; the effective size is
 * $K_{\text{eff}} = K + |\text{OOV}|$. Two encode calls on the same instance
 * therefore share OOV ids, and `vocabSize` in the result grows monotonically.
 *
 * @param info Tokenizer metadata passed through unchanged.
 * @param words Static vocabulary; word `i` has static id `i`.
 */
export function createWordTokenizer(info: TokenizerInfo, words: readonly string[]): Tokenizer {
	if (words.length === 0) {
		throw new Error('createWordTokenizer: vocabulary must not be empty');
	}

	const staticIds = new Map<string, number>();
	for (let i = 0; i < words.length; i++) {
		const word = words[i]!;
		if (staticIds.has(word)) {
			throw new Error(`createWordTokenizer: duplicate word "${word}"`);
		}
		staticIds.set(word, i);
	}

	const vocabSize = words.length;
	const oovIds = new Map<string, number>();
	const oovTokens: string[] = [];

	function tokenAt(id: number): string {
		if (id >= 0 && id < vocabSize) return words[id]!;
		return oovTokens[id - vocabSize] ?? '';
	}

	function idsToTokens(ids: Int32Array): readonly string[] {
		const tokens: string[] = new Array<string>(ids.length);
		for (let i = 0; i < ids.length; i++) {
			tokens[i] = tokenAt(ids[i]!);
		}
		return tokens;
	}

	/**
	 * Decode ids back to text.
	 *
	 * Tokens are concatenated with a single space inserted between them,
	 * except where that would contradict the input:
	 *
	 * - a `\n` token emits a newline with no space on either side;
	 * - a `' '` token emits its own space (no extra separator around it);
	 * - no space before {@link CLOSING_PUNCTUATION} or after
	 *   {@link OPENING_PUNCTUATION} (which is why straight quotes, present in
	 *   both sets, are ambiguous when they are not separated by a space
	 *   token);
	 * - the first token has no leading space.
	 *
	 * Round-trip limits: digits, `/_@#`, emoji and unspaced neutral
	 * punctuation are separate tokens and gain spaces on decode; combining
	 * marks are not letters and also split. Only text that satisfies the
	 * spacing rules above satisfies `decode(encode(t).ids) ===
	 * normalizeWordText(t)`.
	 */
	function decode(ids: Int32Array): string {
		let out = '';
		let prev: string | null = null;
		for (let i = 0; i < ids.length; i++) {
			const token = tokenAt(ids[i]!);
			if (token === '') continue;
			if (prev !== null && needsSpace(prev, token)) out += ' ';
			out += token;
			prev = token;
		}
		return out;
	}

	return {
		info,
		vocabSize,
		encode(text: string): EncodedText {
			const tokens = segmentWordText(normalizeWordText(text));
			const ids = new Int32Array(tokens.length);
			for (let i = 0; i < tokens.length; i++) {
				const token = tokens[i]!;
				let id = staticIds.get(token);
				if (id === undefined) {
					id = oovIds.get(token);
					if (id === undefined) {
						id = vocabSize + oovTokens.length;
						oovIds.set(token, id);
						oovTokens.push(token);
					}
				}
				ids[i] = id;
			}
			return { ids, vocabSize: vocabSize + oovTokens.length };
		},
		decode,
		idsToTokens,
	};
}

/** Whether two adjacent decoded tokens need a separating space. */
function needsSpace(prev: string, token: string): boolean {
	if (token === ' ' || token === '\n' || prev === ' ' || prev === '\n') return false;
	if (CLOSING_PUNCTUATION.has(token)) return false;
	if (OPENING_PUNCTUATION.has(prev)) return false;
	return true;
}
