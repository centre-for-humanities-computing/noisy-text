#!/usr/bin/env node
// Read the workflow's comment markers and commit trailers once.
//
// Comments are forge's `{ author, body, createdAt }`; commits are message
// strings. The reader returns the newest walk, plan and review, the trailer
// parts, and the plan resume point. Stop conditions are data, never thrown.
const MARKER = /^\s*<!--\s*(walk|plan|review)\b(.*?)-->\s*$/;

// A marker counts only as a comment's first non-blank line; quoted or fenced
// markers are prose.
export function marker(body) {
	const first = String(body ?? '').split(/\r?\n/).find((line) => line.trim() !== '');
	if (first === undefined) return null;
	const match = MARKER.exec(first);
	if (!match) return null;
	const kind = match[1];
	const rest = match[2].trim().replace(/^:/, '').trim();
	if (kind === 'walk') return rest === '' ? { kind } : null;
	if (kind === 'plan') {
		const value = /^(?:round=)?(\d+)$/.exec(rest);
		return value ? { kind, number: Number(value[1]) } : null;
	}
	const value = /^round=(\d+)$/.exec(rest);
	return value ? { kind, round: Number(value[1]) } : null;
}

const stamp = (comment, index) => {
	const time = Date.parse(comment?.createdAt ?? '');
	return Number.isNaN(time) ? index : time;
};

function newest(comments, kind) {
	let best = null;
	(comments ?? []).forEach((comment, index) => {
		const parsed = marker(comment?.body);
		if (!parsed || parsed.kind !== kind) return;
		if (!best || stamp(comment, index) >= stamp(best.comment, best.index)) best = { comment, parsed, index };
	});
	return best;
}

function isSlicesHeader(line) {
	if (!/^\s*(?:\*\*|##)/.test(line)) return false;
	return line.replace(/[#*:]/g, '').trim().toLowerCase() === 'slices';
}

function kindOf(text) {
	const match = /^\s*\**\s*(behavioral|mechanical)\b/i.exec(text);
	return match ? match[1].toLowerCase() : null;
}

// The plan's Slices section is prose with one numbered line per slice. Return
// the raw lines and a detected kind; no invented sentence grammar.
function readSlices(body) {
	const lines = String(body ?? '').split(/\r?\n/);
	const start = lines.findIndex(isSlicesHeader);
	if (start === -1) return null;
	const entries = [];
	for (let i = start + 1; i < lines.length; i += 1) {
		const line = lines[i];
		if (/^\s*#{1,6}\s/.test(line)) break;
		const entry = /^\s*\d+\.\s+(.+?)\s*$/.exec(line);
		if (entry) entries.push({ text: entry[1], kind: kindOf(entry[1]) });
	}
	return { count: entries.length, entries };
}

function readVerdict(body) {
	const match = /^\s*(?:\*\*)?Verdict:(?:\*\*)?\s*([A-Za-z]+)/im.exec(String(body ?? ''));
	return match ? match[1].toLowerCase() : null;
}

const TRAILERS = {
	plan: /^Plan:\s*(\d+)\s*$/,
	slice: /^Slice:\s*(\d+)\s*\/\s*(\d+)\s*$/,
	kind: /^Kind:\s*(behavioral|mechanical)\s*$/i,
	fixes: /^Fixes:\s*review\s+(\d+)\s*$/i
};

export function parseTrailers(body) {
	const result = { plan: null, slice: null, kind: null, fixes: [] };
	for (const line of String(body ?? '').split(/\r?\n/)) {
		let match;
		if ((match = TRAILERS.plan.exec(line))) result.plan = Number(match[1]);
		else if ((match = TRAILERS.slice.exec(line))) result.slice = { done: Number(match[1]), total: Number(match[2]) };
		else if ((match = TRAILERS.kind.exec(line))) result.kind = match[1].toLowerCase();
		else if ((match = TRAILERS.fixes.exec(line))) result.fixes.push(Number(match[1]));
	}
	return result;
}

const planOf = (entry) => entry.plan ?? 1;

// Highest Slice: k/n under the newest plan, or 1 when none. A known plan total
// wins; a trailer total that disagrees is a reason, not a throw.
export function planResume(entries = [], plan = null, expectedTotal = null) {
	const numbers = entries.map(planOf);
	const number = plan ?? (numbers.length ? Math.max(...numbers) : 1);
	const slices = entries.filter((entry) => planOf(entry) === number && entry.slice);
	const totals = [...new Set(slices.map((entry) => entry.slice.total))];
	const done = slices.reduce((max, entry) => Math.max(max, entry.slice.done), 0);
	const total = expectedTotal ?? (totals.length ? totals[0] : null);
	const stops = [];
	if (totals.length > 1) stops.push(`slice totals disagree under plan ${number}: ${totals.join(', ')}`);
	if (expectedTotal !== null && totals.some((value) => value !== expectedTotal)) {
		stops.push(`commit total ${totals.join(', ')} disagrees with plan ${number} total ${expectedTotal}`);
	}
	const past = slices.find((entry) => entry.slice.done > entry.slice.total);
	if (past) stops.push(`slice ${past.slice.done}/${past.slice.total} under plan ${number} is past its total`);
	return { plan: number, done, total, next: total === null || done < total ? done + 1 : null, stops };
}

export function readComments(comments = []) {
	const walk = newest(comments, 'walk');
	const plan = newest(comments, 'plan');
	const review = newest(comments, 'review');
	return {
		walk: walk ? walk.comment : null,
		plan: plan
			? { number: plan.parsed.number, comment: plan.comment, slices: readSlices(plan.comment.body) }
			: null,
		review: review
			? { round: review.parsed.round, verdict: readVerdict(review.comment.body), comment: review.comment }
			: null
	};
}

export function readCommits(messages = []) {
	const entries = (messages ?? []).map(parseTrailers);
	const fixes = [...new Set(entries.flatMap((entry) => entry.fixes))].sort((a, b) => a - b);
	return { entries, fixes };
}

export function readRecord({ comments = [], commits = [] } = {}) {
	const parts = readComments(comments);
	const { entries, fixes } = readCommits(commits);
	const expected = parts.plan?.slices ? parts.plan.slices.count : null;
	const { stops, ...resume } = planResume(entries, parts.plan?.number ?? null, expected);
	if (parts.review) parts.review.fixed = fixes;
	return { ...parts, resume, stops };
}
