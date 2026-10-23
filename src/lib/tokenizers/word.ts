/**
 * Pure word-level normalization and segmentation.
 *
 * A "word" is a maximal run of Unicode letters (category `L`) that may be
 * joined by internal apostrophes or hyphens:
 * $w = L^{+}(\,[’'\-]\,L^{+})^{*}$. Everything else is emitted one Unicode
 * code point at a time, so punctuation, digits, emoji and newlines all become
 * their own tokens and no character is dropped.
 */

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
