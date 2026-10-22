#!/usr/bin/env node
// Builds one review packet per slice commit from the round plan and git.
// No dependencies. See .opencode/command/review.md for how the packets are used.
//
//   node scripts/slice-pack.mjs --plan <plan.md> --base <ref> --out <dir>
//     [--head <ref>] [--context <n>]
//
// Exit 2 on usage errors; exit 1 when the range has no slice commits or a
// commit whose slice has no plan entry.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

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

const isExcluded = (path) => path.startsWith('.ai/') || path === 'package-lock.json';

// Every bullet whose value may wrap onto indented continuation lines.
const PLAN_FIELDS = new Map([
	['Kind', 'kind'],
	['Budget', 'budget'],
	['Files', 'files'],
	['Tests', 'tests'],
	['Covers', 'covers'],
	['Commit', 'commit'],
	['Reviewer note', 'reviewerNote'],
]);

/**
 * Parse the `## Slices` section of a round plan.
 *
 * Continuation lines are joined to the active bullet: a trailing `-` is a
 * soft-wrap hyphen and is dropped, otherwise the pieces join with one space.
 *
 * @param {string} markdown
 * @returns {{ id: string, idea: string, kind: string, budget: number,
 *   files: string, tests: string, covers: string, commit: string,
 *   reviewerNote: string, entry: string }[]}
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
				budget: '',
				files: '',
				tests: '',
				covers: '',
				commit: '',
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
			field = PLAN_FIELDS.get(bullet[1]) ?? null;
			if (field) current[field] = bullet[2].trim();
			continue;
		}

		if (line.trim() === '') {
			field = null;
		} else if (field && /^\s+\S/.test(line)) {
			const value = current[field];
			const next = line.trim();
			current[field] = value.endsWith('-')
				? `${value.slice(0, -1)}${next}`
				: `${value} ${next}`.trim();
		}
	}

	for (const slice of slices) {
		const number = /\d+/.exec(slice.budget);
		slice.budget = number ? Number(number[0]) : 0;
		slice.entry = slice.entry.replace(/\s+$/, '');
	}
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

/**
 * Read slice commits in `base..head`, with the changed-line count and paths.
 *
 * @param {{ base: string, head: string }} range
 * @returns {{ sha: string, short: string, subject: string, slice: string,
 *   kind: string, added: number, removed: number, total: number, paths: string[] }[]}
 */
export function collectSlices({ base, head }) {
	const git = (...args) =>
		execFileSync('git', args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
	const raw = git(
		'log',
		'--reverse',
		'--format=%H%x1f%h%x1f%s%x1f%(trailers:key=Slice,valueonly,separator=)%x1f%(trailers:key=Kind,valueonly,separator=)%x1e',
		`${base}..${head}`,
	);

	const slices = [];
	for (const record of raw.split('\x1e')) {
		const line = record.trim();
		if (!line) continue;
		const [sha, short, subject, rawSlice, kind] = line.split('\x1f').map((x) => x.trim());
		if (!sha || !rawSlice) continue;
		const slice = rawSlice.split('/')[0];
		if (slice === 'report') continue;

		let added = 0;
		let removed = 0;
		const paths = [];
		const numstat = git('show', '--numstat', '--format=', '--no-renames', sha);
		for (const stat of numstat.split('\n')) {
			const [a, d, path] = stat.split('\t');
			if (!path || a === '-' || isExcluded(path)) continue;
			added += Number(a);
			removed += Number(d);
			paths.push(path);
		}
		slices.push({
			sha,
			short,
			subject,
			slice,
			kind,
			added,
			removed,
			total: added + removed,
			paths,
		});
	}
	return slices;
}

/**
 * Render the index that tells `/review` which slices to delegate.
 *
 * @param {ReturnType<typeof collectSlices> & {
 *   decision: { review: boolean, reason: string }, packet?: boolean }[]} entries
 * @returns {string}
 */
export function renderIndex(entries) {
	const reviewed = entries.filter((entry) => entry.decision.review).length;
	const lines = [
		'# Slice review index',
		'',
		`- Entries: ${entries.length} (review ${reviewed}, skip ${entries.length - reviewed})`,
		'',
	];
	for (const entry of entries) {
		const decision = entry.decision.review ? 'review' : 'skip';
		const packet = entry.decision.review && entry.packet ? ` → \`${entry.slice}.md\`` : '';
		lines.push(
			`- \`${entry.slice}\` \`${entry.short}\` ${entry.kind || 'unknown'} +${entry.added}/-${entry.removed} = ${entry.total} — ${entry.subject} — ${decision}: ${entry.decision.reason}${packet}`,
		);
	}
	lines.push('');
	return lines.join('\n');
}

const isTestPath = (path) => /(\.test\.|\.spec\.)[cm]?[jt]sx?$/.test(path);

/**
 * The diff of one slice commit only, with the given context.
 *
 * @param {string} sha
 * @param {number} [context]
 * @returns {string}
 */
export function diffFor(sha, context = 10) {
	return execFileSync('git', ['show', '--format=', '--no-renames', `-U${context}`, sha], {
		encoding: 'utf8',
		maxBuffer: 512 * 1024 * 1024,
	}).replace(/\s+$/, '');
}

/**
 * Render one self-contained packet for a slice reviewer.
 *
 * @param {ReturnType<typeof collectSlices>[number] & {
 *   plan: ReturnType<typeof parsePlanSlices>[number],
 *   decision: { review: boolean, reason: string },
 *   diff: string, context: number, packet: boolean }} entry
 * @returns {string}
 */
export function renderPacket(entry) {
	const { plan, decision } = entry;
	const testPaths = entry.paths.filter(isTestPath);
	const priorities = priorityFor(entry.paths);
	const budgetLimit = plan.budget > 0 ? Math.ceil(plan.budget * 1.25) : null;
	const budgetOk = budgetLimit === null || entry.total <= budgetLimit;
	return [
		`# Slice ${entry.slice} — ${entry.subject}`,
		'',
		`- Commit: \`${entry.short}\` — ${entry.subject}`,
		`- Kind: ${entry.kind || 'unknown'} (plan: ${plan.kind || 'unknown'})`,
		`- Size: +${entry.added}/-${entry.removed} = ${entry.total} lines; plan budget ${plan.budget}`,
		`- Tests in commit: ${testPaths.length ? testPaths.join(', ') : 'none'}`,
		'- Review focus: correctness; test adequacy',
		`- Priority: ${priorities.length ? priorities.map((hit) => `${hit.label} (${hit.path})`).join(', ') : 'none'}`,
		`- Decision: ${decision.review ? 'review' : 'skip'} — ${decision.reason}`,
		'',
		'## Plan entry',
		'',
		plan.entry,
		'',
		'## Script checks',
		'',
		`- Kind matches plan: ${entry.kind === plan.kind ? 'PASS' : 'CHECK'} (commit ${entry.kind || 'unknown'}, plan ${plan.kind || 'unknown'})`,
		`- Size within budget: ${budgetOk ? 'PASS' : 'CHECK'} (${entry.total} lines, budget ${plan.budget}${budgetLimit === null ? '' : `, 1.25x = ${budgetLimit}`})`,
		`- Tests in slice: ${testPaths.length ? 'PASS' : 'CHECK'} (${testPaths.length ? testPaths.join(', ') : 'none'})`,
		'',
		`## Diff (-U${entry.context})`,
		'',
		'`````diff',
		entry.diff,
		'`````',
		'',
	].join('\n');
}

/**
 * Render the one-pass note for slices that were skipped.
 *
 * @param {(ReturnType<typeof collectSlices>[number] & {
 *   decision: { review: boolean, reason: string } })[]} entries
 * @returns {string}
 */
export function renderSkipped(entries) {
	const lines = ['# Skipped slices', '', 'These are reviewed together in the integrator pass.', ''];
	for (const entry of entries) {
		lines.push(
			`- \`${entry.slice}\` \`${entry.short}\` ${entry.kind || 'unknown'} +${entry.added}/-${entry.removed} = ${entry.total} — ${entry.subject} — ${entry.decision.reason}`,
		);
	}
	lines.push('');
	return lines.join('\n');
}

/**
 * Write the packets for one run, replacing the files a previous run generated.
 *
 * Only generated names are removed (`INDEX.md`, `_skipped.md`, `S*.md`), so
 * unrelated files in `out` survive. The skipped note is always written, even
 * when nothing was skipped, so a re-run cannot leave a stale one behind.
 *
 * @param {string} out
 * @param {(ReturnType<typeof collectSlices>[number] & {
 *   decision: { review: boolean, reason: string }, packet?: boolean })[]} entries
 */
export function writeOutput(out, entries) {
	mkdirSync(out, { recursive: true });
	for (const name of readdirSync(out)) {
		if (name === 'INDEX.md' || name === '_skipped.md' || /^S[^/]*\.md$/.test(name)) {
			unlinkSync(join(out, name));
		}
	}
	for (const entry of entries.filter((candidate) => candidate.packet)) {
		writeFileSync(join(out, `${entry.slice}.md`), renderPacket(entry));
	}
	writeFileSync(
		join(out, '_skipped.md'),
		renderSkipped(entries.filter((entry) => !entry.decision.review)),
	);
	writeFileSync(join(out, 'INDEX.md'), renderIndex(entries));
}

function main() {
	const argv = process.argv.slice(2);
	const value = (name, fallback) => {
		const index = argv.indexOf(name);
		return index >= 0 ? argv[index + 1] : fallback;
	};
	const planPath = value('--plan');
	const out = value('--out');
	const base = value('--base');
	if (!planPath || !out || !base) {
		console.error(
			'usage: node scripts/slice-pack.mjs --plan <plan.md> --base <ref> --out <dir> ' +
				'[--head <ref>] [--context <n>]',
		);
		process.exit(2);
	}
	const head = value('--head', 'HEAD');
	const context = Number(value('--context', '10'));

	const plan = parsePlanSlices(readFileSync(planPath, 'utf8'));
	const byId = new Map(plan.map((slice) => [slice.id, slice]));
	const commits = collectSlices({ base, head });
	if (commits.length === 0) {
		console.error(`no slice commits in ${base}..${head}`);
		process.exit(1);
	}
	const entries = commits.map((commit) => {
		const planId = planIdFor(commit.slice);
		const planSlice = planId ? byId.get(planId) : undefined;
		if (!planSlice) {
			console.error(`no plan entry for slice ${commit.slice} (${commit.short})`);
			process.exit(1);
		}
		const decision = decide({ kind: commit.kind, total: commit.total, paths: commit.paths });
		return {
			...commit,
			plan: planSlice,
			decision,
			context,
			diff: decision.review ? diffFor(commit.sha, context) : '',
			packet: decision.review,
		};
	});

	writeOutput(out, entries);
	const skipped = entries.filter((entry) => !entry.decision.review);
	process.stdout.write(
		`wrote ${join(out, 'INDEX.md')}: ${entries.length} entries ` +
			`(${entries.length - skipped.length} packets, ${skipped.length} skipped)\n`,
	);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
