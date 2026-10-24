/**
 * Parser for the static word-vocabulary JSON files.
 *
 * The file is an object:
 *
 * ```json
 * { "version": 1, "source": "...", "license": "...", "words": ["a", "b"], "ranks": [1, 0] }
 * ```
 *
 * `ranks[i]` is the rank of `words[i]`; the returned array is ordered by
 * ascending rank so that index `i` is the static token id $i \in 0 \ldots K-1$.
 * Validation is strict and throws `Error('parseWordVocab: <reason>')` on the
 * first violation. The function is pure: it does not fetch, keeps no state and
 * does not mutate `value`.
 */

/** Throw a prefixed, specific validation error. */
function fail(reason: string): never {
	throw new Error(`parseWordVocab: ${reason}`);
}

/**
 * Validate an already-parsed JSON value and return the words ordered by rank.
 *
 * Unknown extra fields are ignored. The input must be a plain object with:
 * - `version`: a finite number;
 * - `source`, `license`: non-empty strings;
 * - `words`: a non-empty array of unique, non-empty strings without whitespace;
 * - `ranks`: integers of the same length as `words`, a permutation of
 *   $0 \ldots n-1$.
 */
export function parseWordVocab(value: unknown): readonly string[] {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		fail('expected a JSON object');
	}
	const obj = value as Record<string, unknown>;
	const { version, source, license, words, ranks } = obj;

	if (typeof version !== 'number' || !Number.isFinite(version)) {
		fail('"version" must be a finite number');
	}
	if (typeof source !== 'string' || source.length === 0) {
		fail('"source" must be a non-empty string');
	}
	if (typeof license !== 'string' || license.length === 0) {
		fail('"license" must be a non-empty string');
	}
	if (!Array.isArray(words) || words.length === 0) {
		fail('"words" must be a non-empty array');
	}
	if (!Array.isArray(ranks)) {
		fail('"ranks" must be an array');
	}
	if (ranks.length !== words.length) {
		fail('"ranks" must have the same length as "words"');
	}

	const wordList: string[] = [];
	const seen = new Set<string>();
	for (let i = 0; i < words.length; i++) {
		const word: unknown = words[i];
		if (typeof word !== 'string') {
			fail(`"words[${i}]" must be a string`);
		}
		if (word.length === 0) {
			fail(`"words[${i}]" must be non-empty`);
		}
		if (/\s/u.test(word)) {
			fail(`"words[${i}]" must not contain whitespace`);
		}
		if (seen.has(word)) {
			fail(`duplicate word "${word}"`);
		}
		seen.add(word);
		wordList.push(word);
	}

	const ordered: string[] = new Array<string>(wordList.length);
	const used = new Uint8Array(wordList.length);
	for (let i = 0; i < ranks.length; i++) {
		const rank: unknown = ranks[i];
		if (typeof rank !== 'number' || !Number.isInteger(rank)) {
			fail(`"ranks[${i}]" must be an integer`);
		}
		if (rank < 0 || rank >= wordList.length) {
			fail(`"ranks[${i}]" must be in [0, ${wordList.length - 1}]`);
		}
		if (used[rank] === 1) {
			fail(`duplicate rank ${rank}`);
		}
		used[rank] = 1;
		ordered[rank] = wordList[i]!;
	}

	return ordered;
}
