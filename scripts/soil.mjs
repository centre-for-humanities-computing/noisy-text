// Read the three soil files as data: journal entries, compost lines and map
// modules, with the commit that added each where git can tell.
//
// Parsing is pure and tolerant of the formats the files actually use. Dates
// come from the text first; blame supplies the adding commit, a date fallback
// and the issue that commit names. `Plan:` is never read as an issue.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { git } from './git.mjs';

const FILES = {
	journal: '.omhu/JOURNAL.md',
	compost: '.omhu/COMPOST.md',
	map: '.omhu/MAP.md'
};

// `## YYYY-MM-DD — kind [#N] — question`; the separator is an em dash or a
// spaced hyphen, and the kind may carry the issue number.
const JOURNAL_HEADING = /^##\s+(\d{4}-\d{2}-\d{2})\s+[—–-]\s+(.+?)\s+[—–-]\s+(.+)$/;
const KIND = /^([A-Za-z]+)(?:\s+#(\d+))?\s*$/;

// `- YYYY-MM-DD — idea — count — source`; the idea is greedy so an em dash
// inside it does not split the line.
const COMPOST_LINE = /^-\s+(\d{4}-\d{2}-\d{2})\s+[—–-]\s+(.*)\s+[—–-]\s+(\d+)\s+[—–-]\s+(.+)$/;
const BOLD_MODULE = /^-\s+\*\*(.+?)\*\*\s*\(([^)]*)\)\s*:\s*(.*)$/;

const read = (file, cwd) => {
	try {
		return readFileSync(join(cwd, file), 'utf8');
	} catch {
		return '';
	}
};

export function parseJournal(text) {
	const lines = String(text ?? '').split(/\r?\n/);
	const entries = [];
	let current = null;
	lines.forEach((line, index) => {
		if (/^##\s+/.test(line)) {
			const match = JOURNAL_HEADING.exec(line);
			if (!match) {
				current = null;
				return;
			}
			const [, date, kindPart, question] = match;
			const kind = KIND.exec(kindPart.trim());
			current = {
				date,
				kind: kind ? kind[1].toLowerCase() : kindPart.trim(),
				issue: kind?.[2] ? Number(kind[2]) : null,
				question: question.trim(),
				facts: [],
				workflow: false,
				body: [],
				line: index + 1
			};
			entries.push(current);
			return;
		}
		if (current) current.body.push(line);
	});
	for (const entry of entries) {
		while (entry.body.length && entry.body.at(-1).trim() === '') entry.body.pop();
		entry.facts = entry.body
			.filter((line) => /^\s*(?:\*\*)?Facts:(?:\*\*)?/i.test(line))
			.map((line) => line.trim());
		entry.workflow = entry.body.some((line) => line.includes('[workflow]'));
		entry.body = entry.body.join('\n').trim();
	}
	return entries;
}

export function parseCompost(text) {
	const entries = [];
	String(text ?? '').split(/\r?\n/).forEach((line, index) => {
		const match = COMPOST_LINE.exec(line);
		if (!match) return;
		entries.push({
			date: match[1],
			idea: match[2].trim(),
			count: Number(match[3]),
			source: match[4].trim(),
			issue: null,
			commit: null,
			line: index + 1
		});
	});
	return entries;
}

const backticks = (text) => [...String(text).matchAll(/`([^`]+)`/g)].map((match) => match[1]);

const isBullet = (line) => /^-\s+/.test(line);
const wraps = (line) => /^[ \t]+\S/.test(line);

function module(name, paths, description, line) {
	return { name, paths, description, issue: null, commit: null, date: null, line };
}

function parseModule(text, line) {
	const bold = BOLD_MODULE.exec(text);
	if (bold) {
		const paths = backticks(bold[2]);
		return module(bold[1].trim(), paths.length ? paths : [bold[2].trim()].filter(Boolean), bold[3].trim(), line);
	}
	const separator = text.search(/\s[—–-]\s/);
	if (separator === -1) return null;
	const paths = backticks(text.slice(1, separator));
	if (!paths.length) return null;
	return module(paths[0], paths, text.slice(separator).replace(/^\s*[—–-]\s*/, '').trim(), line);
}

export function parseMap(text) {
	const lines = String(text ?? '').split(/\r?\n/);
	const entries = [];
	let inParts = false;
	let index = 0;
	while (index < lines.length) {
		const line = lines[index];
		if (/^##\s+/.test(line)) {
			inParts = /^##\s+the parts\s*$/i.test(line);
			index += 1;
			continue;
		}
		const bullet = BOLD_MODULE.test(line) || (inParts && isBullet(line));
		if (!bullet) {
			index += 1;
			continue;
		}
		const at = index + 1;
		let joined = line;
		index += 1;
		while (index < lines.length && wraps(lines[index])) {
			joined += ` ${lines[index].trim()}`;
			index += 1;
		}
		const entry = parseModule(joined, at);
		if (entry) entries.push(entry);
	}
	return entries;
}

// Map each line of a file to the commit blame assigns it; null when git cannot
// read the file.
export function blameLines(cwd, file) {
	const output = git(cwd, ['blame', '--line-porcelain', '--', file]);
	if (output === null) return null;
	const byLine = new Map();
	for (const line of output.split('\n')) {
		const match = /^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/.exec(line);
		if (match) byLine.set(Number(match[2]), match[1]);
	}
	return byLine;
}

function issueIn(message) {
	const closes = /\bCloses\s+#(\d+)/i.exec(String(message ?? ''));
	if (closes) return Number(closes[1]);
	const subject = String(message ?? '').split(/\r?\n/)[0];
	const named = /\(#(\d+)\)/.exec(subject);
	return named ? Number(named[1]) : null;
}

function commitOf(cwd, sha, cache) {
	if (!sha || /^0+$/.test(sha)) return null;
	if (cache.has(sha)) return cache.get(sha);
	const output = git(cwd, ['show', '-s', '--format=%aI%x00%B', sha]);
	let info = null;
	if (output !== null) {
		const [date, message = ''] = output.split('\0');
		info = {
			sha,
			date: date?.slice(0, 10) || null,
			issue: issueIn(message),
			subject: message.split(/\r?\n/)[0]
		};
	}
	cache.set(sha, info);
	return info;
}

function annotate(entries, cwd, file, cache) {
	const byLine = blameLines(cwd, file);
	for (const entry of entries) {
		const commit = commitOf(cwd, byLine?.get(entry.line), cache);
		entry.commit = commit?.sha ?? null;
		if (entry.issue === null) entry.issue = commit?.issue ?? null;
		if (entry.date === null) entry.date = commit?.date ?? null;
	}
}

export function readSoil({ cwd = process.cwd(), files = FILES } = {}) {
	const cache = new Map();
	const journal = parseJournal(read(files.journal, cwd));
	const compost = parseCompost(read(files.compost, cwd));
	const map = parseMap(read(files.map, cwd));
	annotate(journal, cwd, files.journal, cache);
	annotate(compost, cwd, files.compost, cache);
	annotate(map, cwd, files.map, cache);
	return { journal, compost, map };
}
