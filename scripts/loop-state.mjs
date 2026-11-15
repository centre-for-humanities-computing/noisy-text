// Derive one issue's loop stage from the markers, branch and pull request.
//
// The ladder is pure: callers supply the branch's commit messages, its newest
// commit time and the files the last slice touched. No forge or git call runs
// here, so a forge failure can be represented as an `unknown` stage instead of
// an exception.
import { readRecord } from './record.mjs';

export function branchIssue(branch) {
	const match = /^(\d+)-/.exec(String(branch ?? ''));
	return match ? Number(match[1]) : null;
}

const time = (value) => Date.parse(value ?? '');

// Newest of the issue update, any comment and the branch's latest commit.
export function lastActivity({ issue, commitAt = null } = {}) {
	const times = [
		issue?.updatedAt,
		...(issue?.comments ?? []).map((comment) => comment?.createdAt),
		commitAt
	].filter((value) => !Number.isNaN(time(value)));
	if (!times.length) return null;
	return times.reduce((newest, value) => (time(value) > time(newest) ? value : newest));
}

// A merged issue's absent walk, plan or review markers mean the human skipped
// those steps, not that the record lost them.
function skippedSteps(stage) {
	if (stage === 'harvested') return ['walk', 'plan', 'implement', 'review'];
	if (stage === 'in review') return ['walk', 'plan', 'implement'];
	if (stage === 'soil slice' || stage === 'implementing') return ['walk', 'plan'];
	if (stage === 'planned') return ['walk'];
	return [];
}

export function loopState({
	issue = null,
	branch = null,
	pr = null,
	commits = [],
	commitAt = null,
	lastSliceFiles = [],
	forgeError = null
} = {}) {
	const number = issue?.number ?? branchIssue(branch);
	const title = issue?.title ?? '';
	const activity = lastActivity({ issue, commitAt });
	const base = { number, title, milestone: issue?.milestone ?? null, lastActivity: activity, skipped: [] };
	if (forgeError) return { ...base, stage: 'unknown', slice: null, error: forgeError };

	const record = readRecord({ comments: issue?.comments ?? [], commits });
	const walk = Boolean(record.walk);
	const plan = Boolean(record.plan);
	const review = Boolean(record.review);
	const total = record.resume.total;
	const done = record.resume.done;
	const onBranch = number !== null && branchIssue(branch) === number;
	const implementing = onBranch && done > 0;
	const implemented = implementing || Boolean(pr);
	const soil = implementing && total !== null && done >= total &&
		lastSliceFiles.some((file) => /^\.omhu\//.test(file) || file === 'AGENTS.md');
	const merged = pr?.state === 'merged';

	let stage = 'seed';
	if (merged) stage = 'harvested';
	else if (pr || review) stage = 'in review';
	else if (soil) stage = 'soil slice';
	else if (implementing) stage = 'implementing';
	else if (plan) stage = 'planned';
	else if (walk) stage = 'walked';

	const doneSteps = { walk, plan, implement: implemented, review };
	const skipped = skippedSteps(stage).filter((step) => !doneSteps[step]);
	return {
		...base,
		stage,
		slice: total === null ? null : { done, total },
		skipped
	};
}
