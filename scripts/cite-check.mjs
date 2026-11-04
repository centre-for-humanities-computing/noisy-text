#!/usr/bin/env node
// Refuse citations that do not exist at a commit.
//
// Reads a review comment, takes every inline-code span, and checks each cited
// line against the tree at that commit. Fenced blocks are ignored so a pasted
// repro transcript cannot invent a citation; prose is ignored too, because only
// inline code is evidence.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const EXIT = { ok: 0, citation: 1, error: 2 };

export function usage() {
	return `Usage: node scripts/cite-check.mjs <commit> <comment-file>

Checks every inline-code citation in a comment — \`path:line\`,
\`path:start-end\`, and the common \`#L\`, \`:L\` and comma spellings — against the
tree at <commit>. Fenced blocks and plain prose are ignored.

Exit codes:
  0 every citation exists at that commit
  1 at least one cited path or line range does not exist
  2 usage error or the commit cannot be resolved`;
}

// Inline code only: fenced blocks are quoted output, never citations. A fence
// closes only on the same marker at least as long as the one that opened it, so
// a shorter or different fence inside the block stays content.
function openingFence(line) {
	const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
	if (!match) return null;
	// A backtick fence's info string cannot contain a backtick.
	if (match[1][0] === '`' && match[2].includes('`')) return null;
	return { marker: match[1][0], length: match[1].length };
}

function closesFence(line, open) {
	const match = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line);
	return Boolean(match) && match[1][0] === open.marker && match[1].length >= open.length;
}

export function inlineSpans(markdown) {
	const spans = [];
	let open = null;
	for (const line of markdown.split('\n')) {
		if (open) {
			if (closesFence(line, open)) open = null;
			continue;
		}
		const fence = openingFence(line);
		if (fence) {
			open = fence;
			continue;
		}
		for (const match of line.matchAll(/`([^`]+)`/g)) spans.push(match[1].trim());
	}
	return spans;
}

export function parseCitation(span) {
	const match = /^(.+?)(?:[:#])L?(\d+)(?:(?:-L?|,)(\d+))?$/.exec(span);
	if (!match) return null;
	const start = Number(match[2]);
	return { path: match[1], start, end: match[3] === undefined ? start : Number(match[3]) };
}

function git(args, cwd) {
	const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
	if (result.error) throw new Error(`git could not run: ${result.error.message}`);
	return result;
}

function lineCount(markdown) {
	return markdown === '' ? 0 : markdown.replace(/\n$/, '').split('\n').length;
}

function checkOne(commit, { path, start, end }, cwd) {
	const type = git(['cat-file', '-t', `${commit}:${path}`], cwd);
	if (type.status !== 0) return `\`${path}\` does not exist at ${commit}`;
	if (type.stdout.trim() !== 'blob') return `\`${path}\` is not a file at ${commit}`;
	const content = git(['show', `${commit}:${path}`], cwd);
	if (content.status !== 0) return `\`${path}\` could not be read at ${commit}`;
	if (start < 1 || end < start) return `\`${path}:${start}-${end}\` is not a line range`;
	const lines = lineCount(content.stdout);
	if (end > lines) {
		return `\`${path}:${start}-${end}\` is past the end of \`${path}\` (${lines} lines)`;
	}
	return null;
}

export function checkCitations(commit, markdown, { cwd = process.cwd() } = {}) {
	const failures = [];
	const seen = new Set();
	for (const span of inlineSpans(markdown)) {
		const citation = parseCitation(span);
		if (!citation) continue;
		const key = `${citation.path}:${citation.start}-${citation.end}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const failure = checkOne(commit, citation, cwd);
		if (failure) failures.push(failure);
	}
	return failures;
}

export function main() {
	const [commit, file] = process.argv.slice(2);
	if (!commit || !file) {
		process.stderr.write(`${usage()}\n`);
		process.exitCode = EXIT.error;
		return;
	}
	const cwd = process.cwd();
	const resolved = git(['rev-parse', '--verify', `${commit}^{commit}`], cwd);
	if (resolved.status !== 0) {
		process.stderr.write(`cite-check: cannot resolve commit ${commit}\n`);
		process.exitCode = EXIT.error;
		return;
	}
	let markdown;
	try {
		markdown = readFileSync(file, 'utf8');
	} catch (error) {
		process.stderr.write(`cite-check: cannot read ${file}: ${error.message}\n`);
		process.exitCode = EXIT.error;
		return;
	}
	const failures = checkCitations(commit, markdown, { cwd });
	if (failures.length > 0) {
		process.stderr.write(`${failures.map((failure) => `cite-check: ${failure}`).join('\n')}\n`);
		process.exitCode = EXIT.citation;
		return;
	}
	process.stdout.write('cite-check: every citation exists\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
