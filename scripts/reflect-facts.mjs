#!/usr/bin/env node
// One facts line for /retrospective: walks, review rounds, slices and line churn.
// The command hands over the fetched JSON; a number without evidence is unknown.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
export function usage() {
	return `Usage: node scripts/reflect-facts.mjs --range <revspec> [options]

Prints: Facts: <n> walk \u00b7 <n> review rounds \u00b7 <n> slices \u00b7 +<n>/-<n>
Anything the evidence cannot establish is printed as "unknown".

Options:
  --range <revspec>   git range for churn, e.g. main...HEAD or <sha>^..<sha>
  --issue <path>      issue JSON from \`forge.mjs issue get\`
  --pr <path>         pull-request JSON from \`forge.mjs pr get\`
  --commits <path>    saved commit list from \`forge.mjs pr commits\`
  --help              show this help`;
}

export function parseArgs(argv = []) {
	const options = {};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === '--help' || arg === '-h') {
			options.help = true;
			continue;
		}
		if (arg === '--range' || arg === '--issue' || arg === '--pr' || arg === '--commits') {
			const value = argv[i + 1];
			if (value === undefined || value.startsWith('--')) throw new Error(`${arg} requires a value`);
			options[arg.slice(2)] = value;
			i += 1;
			continue;
		}
		throw new Error(`unknown option ${arg}`);
	}
	return options;
}

function readJson(path) {
	if (!path) return null;
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch {
		return null;
	}
}

export function walkCount(issue) {
	if (!issue || !Array.isArray(issue.comments)) return null;
	return issue.comments.some((comment) => /^\s*<!-- walk -->/.test(String(comment?.body ?? ''))) ? 1 : 0;
}

export function reviewRounds(pr) {
	if (!pr || !Array.isArray(pr.comments)) return null;
	let rounds = 0;
	for (const comment of pr.comments) {
		const match = /<!--\s*review:\s*round=(\d+)\s*-->/.exec(String(comment?.body ?? ''));
		if (match) rounds = Math.max(rounds, Number(match[1]));
	}
	return rounds;
}

export function sliceCount(messages) {
	let slices = 0;
	for (const message of messages) {
		if (/^Slice:\s*\d+\s*\/\s*\d+\s*$/m.test(String(message))) slices += 1;
	}
	return slices;
}

function git(args, cwd) {
	const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
	return result.error || result.status !== 0 ? null : result.stdout;
}

function gitMessages(range, cwd) {
	const out = range ? git(['log', '--format=%B%x00', range], cwd) : null;
	return out === null ? null : out.split('\0').map((message) => message.trim()).filter(Boolean);
}

// Churn uses the symmetric range; the trailers come from the branch side only.
function branchRange(range) {
	return typeof range === 'string' ? range.replace('...', '..') : range;
}

function lineChurn(range, cwd) {
	const out = range ? git(['diff', '--numstat', range], cwd) : null;
	if (out === null) return null;
	let added = 0;
	let deleted = 0;
	for (const line of out.split('\n')) {
		const [a, d] = line.split('\t');
		if (/^\d+$/.test(a)) added += Number(a);
		if (/^\d+$/.test(d)) deleted += Number(d);
	}
	return { added, deleted };
}

function count(value, noun, plural = `${noun}s`, unknownNoun = plural) {
	if (value === null) return `unknown ${unknownNoun}`;
	return `${value} ${value === 1 ? noun : plural}`;
}

export function formatFacts({ walk, rounds, slices, churn }) {
	const lines = churn === null ? 'unknown' : `+${churn.added}/\u2212${churn.deleted}`;
	return `Facts: ${count(walk, 'walk', 'walks', 'walk')} \u00b7 ${count(rounds, 'review round')} \u00b7 ${count(slices, 'slice')} \u00b7 ${lines}`;
}

export function reflectFacts({ cwd = process.cwd(), range, issue, pr, commits } = {}) {
	const fromGit = gitMessages(branchRange(range), cwd);
	const saved = Array.isArray(commits) ? commits.map((commit) => commit?.message ?? '') : null;
	// Slices are known only when a `Slice: k/n` trailer exists in the branch log
	// or the saved list; an empty list is not evidence of zero.
	const found = [fromGit, saved]
		.filter((messages) => messages !== null)
		.map(sliceCount)
		.filter((slices) => slices > 0);
	const slices = found.length ? Math.max(...found) : null;
	return formatFacts({
		walk: walkCount(issue),
		rounds: reviewRounds(pr),
		slices,
		churn: lineChurn(range, cwd)
	});
}

export function runReflectFacts(argv = [], { cwd = process.cwd() } = {}) {
	let options;
	try {
		options = parseArgs(argv);
	} catch (error) {
		return { code: 2, stdout: '', stderr: `reflect-facts: ${error.message}\n` };
	}
	if (options.help) return { code: 0, stdout: `${usage()}\n`, stderr: '' };
	const facts = reflectFacts({
		cwd, range: options.range, issue: readJson(options.issue),
		pr: readJson(options.pr), commits: readJson(options.commits)
	});
	return { code: 0, stdout: `${facts}\n`, stderr: '' };
}

export function main() {
	const result = runReflectFacts(process.argv.slice(2));
	if (result.stdout) process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(result.stderr);
	process.exitCode = result.code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
