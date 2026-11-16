#!/usr/bin/env node
// Render the snapshot as one self-contained HTML page: the branch line, each
// open issue's loop badge under its milestone with that milestone's progress,
// then the soil. Everything is inlined and escaped; the file lands in a temp
// directory under one stable name per checkout, so the tracked tree stays clean.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { readSnapshot } from './snapshot.mjs';

const GLANCE = 20;

export const escapeHtml = (value) => String(value ?? '')
	.replaceAll('&', '&amp;')
	.replaceAll('<', '&lt;')
	.replaceAll('>', '&gt;')
	.replaceAll('"', '&quot;')
	.replaceAll("'", '&#39;');

const credit = (entry) => {
	if (entry?.issue !== null && entry?.issue !== undefined) return `#${entry.issue}`;
	if (entry?.commit) return entry.commit.slice(0, 7);
	return '\u2014';
};

// Newest first, capped, with the shown/total line when the cap bites.
function feed(entries = []) {
	const newest = [...entries].slice(-GLANCE).reverse();
	return { newest, note: entries.length > GLANCE ? `${GLANCE} of ${entries.length}` : null };
}

function bar(milestone) {
	const open = Number(milestone?.openIssues ?? 0);
	const closed = Number(milestone?.closedIssues ?? 0);
	const total = open + closed;
	if (!milestone || total === 0) return '';
	const width = Math.round((closed / total) * 100);
	return `<div class="bar" role="img" aria-label="${closed} of ${total} closed"><span style="width:${width}%"></span></div>`;
}

function groupIssues(snapshot) {
	const milestones = Array.isArray(snapshot.milestones) ? snapshot.milestones : [];
	const groups = new Map();
	for (const issue of snapshot.issues ?? []) {
		const title = issue.milestone ?? '';
		if (!groups.has(title)) groups.set(title, []);
		groups.get(title).push(issue);
	}
	return [...groups].map(([title, issues]) => ({
		title,
		issues,
		milestone: milestones.find((row) => row.title === title) ?? null
	}));
}

function issueList(issue) {
	const slice = issue.slice ? ` ${issue.slice.done}/${issue.slice.total}` : '';
	return `<li><span class="badge">${escapeHtml(issue.stage)}</span>`
		+ `<span class="num">#${escapeHtml(issue.number)}</span>`
		+ `<span class="title">${escapeHtml(issue.title)}</span>`
		+ `<span class="slice">${escapeHtml(slice.trim())}</span></li>`;
}

function journalSection(entries) {
	const { newest, note } = feed(entries);
	const rows = newest.map((entry) => `<article>
<h3><time>${escapeHtml(entry.date ?? '\u2014')}</time> \u00b7 ${escapeHtml(entry.kind)} \u00b7 ${escapeHtml(credit(entry))}</h3>
<p class="question">${escapeHtml(entry.question)}</p>
<pre class="body">${escapeHtml(entry.body)}</pre>
</article>`).join('\n');
	return `<section>
<h2>Journal${note ? ` <span class="note">${escapeHtml(note)}</span>` : ''}</h2>
${rows || '<p class="empty">No entries.</p>'}
</section>`;
}

function compostSection(entries) {
	const { newest, note } = feed(entries);
	const rows = newest.map((entry) => `<li><time>${escapeHtml(entry.date ?? '\u2014')}</time> `
		+ `<span class="idea">${escapeHtml(entry.idea)}</span> `
		+ `<span class="credit">${escapeHtml(credit(entry))}</span></li>`).join('\n');
	return `<section>
<h2>Compost${note ? ` <span class="note">${escapeHtml(note)}</span>` : ''}</h2>
${rows ? `<ul class="feed">\n${rows}\n</ul>` : '<p class="empty">No entries.</p>'}
</section>`;
}

function mapSection(entries) {
	const { newest, note } = feed(entries);
	const rows = newest.map((entry) => `<li><strong>${escapeHtml(entry.name)}</strong> \u2014 `
		+ `${escapeHtml(entry.description)} <span class="credit">${escapeHtml(credit(entry))}</span></li>`).join('\n');
	return `<section>
<h2>Map${note ? ` <span class="note">${escapeHtml(note)}</span>` : ''}</h2>
${rows ? `<ul class="feed">\n${rows}\n</ul>` : '<p class="empty">No entries.</p>'}
</section>`;
}

export function renderHtml(snapshot) {
	const project = snapshot?.project ?? {};
	const dirty = project.dirty === null || project.dirty === undefined ? 'unknown' : (project.dirty ? 'dirty' : 'clean');
	const ahead = project.ahead === null || project.ahead === undefined ? '?' : project.ahead;
	const behind = project.behind === null || project.behind === undefined ? '?' : project.behind;
	const groups = groupIssues(snapshot);
	const issues = groups.map(({ title, issues: list, milestone }) => `<section class="group">
<h3>${escapeHtml(title || 'No milestone')}${milestone ? ` <span class="note">${escapeHtml(milestone.closedIssues)}/${escapeHtml(milestone.openIssues + milestone.closedIssues)} closed</span>` : ''}</h3>
${bar(milestone)}
<ul class="issues">
${list.map(issueList).join('\n')}
</ul>
</section>`).join('\n');
	const error = snapshot?.error ? `<p class="error">forge: ${escapeHtml(snapshot.error)}</p>` : '';
	const soil = snapshot?.soil ?? {};

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Omhu overview</title>
<style>
:root {
	color-scheme: light dark;
	--bg: #fbfbf8; --fg: #1c1c1a; --muted: #6a6a64; --line: #deded7;
	--accent: #355e8d; --track: #e5e5de;
}
@media (prefers-color-scheme: dark) {
	:root { --bg: #17181a; --fg: #e9e9e4; --muted: #9b9b95; --line: #33353a; --accent: #8fb4e0; --track: #2b2d31; }
}
* { box-sizing: border-box; }
body {
	margin: 0 auto; max-width: 54rem; padding: 2rem 1.25rem 4rem;
	background: var(--bg); color: var(--fg);
	font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
}
h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
h2 { font-size: 1.15rem; margin: 2.5rem 0 .75rem; padding-bottom: .3rem; border-bottom: 1px solid var(--line); }
h3 { font-size: 1rem; margin: 1.5rem 0 .5rem; }
.meta, .note, .slice, .credit, time { color: var(--muted); }
.note { font-size: .85em; font-weight: 400; }
.meta { margin: 0 0 1rem; }
code, .num { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.error { color: #b23a3a; border: 1px solid currentColor; border-radius: 4px; padding: .5rem .75rem; }
.bar { height: .5rem; background: var(--track); border-radius: 99px; overflow: hidden; margin: .35rem 0 .75rem; }
.bar span { display: block; height: 100%; background: var(--accent); }
.issues { list-style: none; padding: 0; margin: 0; }
.issues li { display: flex; gap: .6rem; align-items: baseline; padding: .3rem 0; border-bottom: 1px solid var(--line); }
.issues li:last-child { border-bottom: 0; }
.badge {
	flex: none; font-size: .78rem; padding: .05rem .45rem; border-radius: 99px;
	border: 1px solid var(--line); color: var(--accent); white-space: nowrap;
}
.title { flex: 1; }
.feed { list-style: none; padding: 0; margin: 0; }
.feed li { padding: .3rem 0; border-bottom: 1px solid var(--line); }
.feed li:last-child { border-bottom: 0; }
article { margin: 0 0 1.5rem; }
article h3 { margin: 0 0 .25rem; font-size: .95rem; }
.question { margin: 0 0 .35rem; font-weight: 600; }
.body { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
.empty { color: var(--muted); }
</style>
</head>
<body>
<header>
<h1>Omhu</h1>
<p class="meta"><code>${escapeHtml(project.branch ?? 'detached')}</code> \u00b7 ${escapeHtml(dirty)} \u00b7 ahead ${escapeHtml(ahead)} \u00b7 behind ${escapeHtml(behind)}</p>
${error}
</header>
<section>
<h2>Issues</h2>
${issues || '<p class="empty">No open issues.</p>'}
</section>
${journalSection(soil.journal ?? [])}
${compostSection(soil.compost ?? [])}
${mapSection(soil.map ?? [])}
</body>
</html>
`;
}

export function main() {
	const cwd = process.cwd();
	const snapshot = readSnapshot({ cwd });
	const name = createHash('sha256').update(cwd).digest('hex').slice(0, 8);
	const file = join(tmpdir(), `omhu-overview-${name}.html`);
	writeFileSync(file, renderHtml(snapshot));
	process.stdout.write(`${file}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
