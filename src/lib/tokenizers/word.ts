/**
 * Pure word-level text normalization.
 *
 * Segmented words are runs of Unicode letters (category `L`) that may be
 * joined by internal apostrophes or hyphens; see `segmentWordText` in the
 * next slice.
 */

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
