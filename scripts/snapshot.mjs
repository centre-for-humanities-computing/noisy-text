#!/usr/bin/env node
// Print one snapshot of the project: branch and git state, each open issue's
// loop stage, and the three soil files. It stores nothing and reads no secret;
// forge access is a subprocess call to `forge.mjs --json`.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { branchIssue, loopState } from './loop-state.mjs';
import { parseTrailers } from './record.mjs';
import { readSoil } from './soil.mjs';

function git(cwd, args) {
	const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
	if (result.error || result.status !== 0) return null;
	return result.stdout;
}

function gitState(cwd) {
	const branch = (git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']) ?? '').trim() || null;
	const status = git(cwd, ['status', '--porcelain']);
	const dirty = status === null ? null : status.trim() !== '';
	const counts = git(cwd, ['rev-list', '--left-right', '--count', 'main...HEAD']);
	let ahead = null;
	let behind = null;
	if (counts !== null) {
		const [left, right] = counts.trim().split(/\s+/).map(Number);
		behind = Number.isNaN(left) ? null : left;
		ahead = Number.isNaN(right) ? null : right;
	}
	return { branch, dirty, ahead, behind };
}

// Newest first, with the full message and commit time.
function branchCommits(cwd) {
	const output = git(cwd, ['log', '--format=%H%x1f%cI%x1f%B%x1e', 'main..HEAD']);
	if (output === null) return [];
	return output.split('\x1e').map((record) => record.trim()).filter(Boolean).map((record) => {
		const [sha, date, ...rest] = record.split('\x1f');
		return { sha, date, message: rest.join('\x1f') };
	});
}

function lastSliceFiles(cwd, commits) {
	const commit = commits.find((entry) => parseTrailers(entry.message).slice);
	if (!commit) return [];
	const output = git(cwd, ['show', '--name-only', '--format=', commit.sha]);
	return output === null ? [] : output.split('\n').filter(Boolean);
}

function runForge(cwd, args) {
	const result = spawnSync(process.execPath, ['scripts/forge.mjs', '--json', ...args], { cwd, encoding: 'utf8' });
	if (result.error) return { error: result.error.message };
	if (result.status !== 0) {
		let message = String(result.stderr ?? '').trim();
		try {
			message = JSON.parse(message).error?.message ?? message;
		} catch {
			// keep the plain stderr text
		}
		return { error: message || `forge exited ${result.status}` };
	}
	try {
		return { value: JSON.parse(result.stdout) };
	} catch (error) {
		return { error: `forge returned invalid JSON: ${error.message}` };
	}
}

function projectIssues(cwd, forge, branch) {
	const listed = forge(cwd, ['issue', 'list']);
	const issues = Array.isArray(listed.value) ? [...listed.value] : [];
	const issueError = listed.error ?? null;
	const current = branchIssue(branch);
	if (current !== null && !issues.some((issue) => issue.number === current)) {
		const one = forge(cwd, ['issue', 'get', String(current)]);
		issues.push(one.value ?? { number: current, title: '', state: 'open', updatedAt: '', comments: [] });
	}
	return { issues, current, issueError };
}

export function readSnapshot({ cwd = process.cwd(), forge = runForge } = {}) {
	const state = gitState(cwd);
	const commits = branchCommits(cwd);
	const sliceFiles = lastSliceFiles(cwd, commits);
	const { issues, current, issueError } = projectIssues(cwd, forge, state.branch);
	const milestones = forge(cwd, ['milestone', 'list']);
	const pull = state.branch ? forge(cwd, ['pr', 'find', '--head', state.branch, '--state', 'all']) : {};
	const error = issueError ?? milestones.error ?? pull.error ?? null;

	const states = issues.map((issue) => {
		const isCurrent = current !== null && issue.number === current;
		return loopState({
			issue,
			branch: isCurrent ? state.branch : null,
			pr: isCurrent ? (pull.value ?? null) : null,
			commits: isCurrent ? commits.map((commit) => commit.message) : [],
			commitAt: isCurrent ? (commits[0]?.date ?? null) : null,
			lastSliceFiles: isCurrent ? sliceFiles : [],
			forgeError: isCurrent && issueError ? issueError : null
		});
	});

	return {
		project: {
			branch: state.branch,
			dirty: state.dirty,
			ahead: state.ahead,
			behind: state.behind,
			current,
			commitAt: commits[0]?.date ?? null
		},
		issues: states,
		milestones: Array.isArray(milestones.value) ? milestones.value : [],
		soil: readSoil({ cwd }),
		error
	};
}

export function formatText(snapshot) {
	const { project, issues, soil } = snapshot;
	const dirty = project.dirty === null ? 'unknown' : (project.dirty ? 'dirty' : 'clean');
	const ahead = project.ahead === null ? '?' : project.ahead;
	const behind = project.behind === null ? '?' : project.behind;
	const lines = [`${project.branch ?? 'detached'}  ${dirty}  ahead ${ahead}  behind ${behind}`];
	for (const issue of issues) {
		const slice = issue.slice ? `${issue.slice.done}/${issue.slice.total}` : '-';
		lines.push(`#${issue.number}  ${issue.stage}  ${slice}  ${issue.lastActivity ?? '-'}  ${issue.title}`.trimEnd());
	}
	lines.push(`soil  journal ${soil.journal.length}  compost ${soil.compost.length}  map ${soil.map.length}`);
	if (snapshot.error) lines.push(`error  ${snapshot.error}`);
	return lines.join('\n');
}

export function main() {
	const snapshot = readSnapshot();
	const text = process.argv.includes('--text');
	process.stdout.write(`${text ? formatText(snapshot) : JSON.stringify(snapshot, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
