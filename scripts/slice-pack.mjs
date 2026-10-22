// Review-packet helpers: parse a round plan and decide which slices to review.
// No dependencies. See .opencode/command/review.md for how the packets are used.

// Directories where a slice is worth a full review even when it is small.
export const PRIORITY_PATHS = [
	{ prefix: 'src/lib/engine/', label: 'engine' },
	{ prefix: 'src/lib/strategies/', label: 'strategies' },
	{ prefix: 'src/lib/schedules/', label: 'schedules' },
	{ prefix: 'src/lib/embeddings/', label: 'embeddings' },
	{ prefix: 'src/lib/tokenizers/', label: 'tokenizers' },
	{ prefix: 'src/lib/workers/', label: 'workers' },
	{ prefix: 'src/lib/stores/', label: 'stores' },
];

/**
 * Parse the `## Slices` section of a round plan.
 *
 * @param {string} markdown
 * @returns {{ id: string, idea: string, kind: string, budget: number,
 *   files: string, tests: string, reviewerNote: string, entry: string }[]}
 */
export function parsePlanSlices(markdown) {
	const slices = [];
	let inSlices = false;
	let current = null;
	let field = null;

	for (const line of markdown.split(/\r?\n/)) {
		if (/^##\s/.test(line)) {
			inSlices = /^##\s+Slices\b/.test(line);
			current = null;
			field = null;
			continue;
		}
		if (!inSlices) continue;

		const heading = /^### (S\d+[a-z]?) — (.+)$/.exec(line);
		if (heading) {
			current = {
				id: heading[1],
				idea: heading[2].trim(),
				kind: '',
				budget: 0,
				files: '',
				tests: '',
				reviewerNote: '',
				entry: line,
			};
			slices.push(current);
			field = null;
			continue;
		}
		if (/^###\s/.test(line)) {
			// Any other level-3 heading ends the current entry.
			current = null;
			field = null;
			continue;
		}
		if (!current) continue;

		current.entry += `\n${line}`;
		const bullet = /^-\s+(Kind|Budget|Files|Tests|Covers|Commit|Reviewer note):\s*(.*)$/.exec(line);
		if (bullet) {
			const key = bullet[1];
			const value = bullet[2].trim();
			if (key === 'Kind') {
				current.kind = value;
				field = null;
			} else if (key === 'Budget') {
				const number = /\d+/.exec(value);
				current.budget = number ? Number(number[0]) : 0;
				field = null;
			} else if (key === 'Files') {
				current.files = value;
				field = 'files';
			} else if (key === 'Tests') {
				current.tests = value;
				field = 'tests';
			} else if (key === 'Reviewer note') {
				current.reviewerNote = value;
				field = 'reviewerNote';
			} else {
				field = null;
			}
			continue;
		}

		if (line.trim() === '') {
			field = null;
		} else if (field && /^\s+\S/.test(line)) {
			current[field] = `${current[field]} ${line.trim()}`.trim();
		}
	}

	for (const slice of slices) slice.entry = slice.entry.replace(/\s+$/, '');
	return slices;
}

/**
 * Map a commit slice id to its plan entry id: `S10b/8` -> `S10`.
 *
 * @param {string | null | undefined} sliceId
 * @returns {string | null}
 */
export function planIdFor(sliceId) {
	if (!sliceId) return null;
	const id = String(sliceId).split('/')[0];
	if (id === 'report') return null;
	const match = /^S(\d+)[a-z]?$/.exec(id);
	return match ? `S${match[1]}` : null;
}

/**
 * Paths that are always worth reviewing, regardless of slice size.
 *
 * @param {string[]} paths
 * @returns {{ path: string, label: string }[]}
 */
export function priorityFor(paths) {
	const hits = [];
	for (const path of paths) {
		const priority = PRIORITY_PATHS.find(({ prefix }) => path.startsWith(prefix));
		if (priority) hits.push({ path, label: priority.label });
	}
	return hits;
}

/**
 * Decide whether a slice needs its own reviewer.
 *
 * @param {{ kind: string, total: number, paths: string[] }} slice
 * @returns {{ review: boolean, reason: string }}
 */
export function decide({ kind, total, paths }) {
	const hits = priorityFor(paths);
	if (hits.length) {
		return {
			review: true,
			reason: `priority path: ${hits.map((hit) => hit.label).join(', ')}`,
		};
	}
	if (kind === 'mechanical') return { review: false, reason: 'mechanical slice' };
	if (total < 60) return { review: false, reason: `${total} lines < 60` };
	return { review: true, reason: `${total} lines` };
}
