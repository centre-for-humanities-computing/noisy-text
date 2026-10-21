#!/usr/bin/env node
// Validates a reviewer's review.json, then renders:
//   review.md    the PR comment body (marker, header, findings first,
//                orientation collapsed); every code quote comes from git
//   review.html  local reading view: one colour per slice, per-commit diffs
//
//   node scripts/review-pack.mjs <review.json> [--base origin/main]
//
// Exit 1 on any validation error (all are listed). No dependencies.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const argv = process.argv.slice(2);
const jsonPath = argv[0];
if (!jsonPath) {
	console.error('usage: node scripts/review-pack.mjs <review.json> [--base <ref>]');
	process.exit(1);
}
const bi = argv.indexOf('--base');
const base = bi >= 0 ? argv[bi + 1] : 'origin/main';
const git = (...a) => execFileSync('git', a, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });

let r;
try {
	r = JSON.parse(readFileSync(jsonPath, 'utf8'));
} catch (e) {
	console.error(`cannot read ${jsonPath}: ${e.message}`);
	process.exit(1);
}
if (!r || typeof r !== 'object' || Array.isArray(r)) {
	console.error(`cannot read ${jsonPath}: review.json must contain a JSON object`);
	process.exit(1);
}
const errors = [];
const err = (m) => errors.push(m);

// ---------- validation ----------
const VERDICTS = ['block', 'fix-and-recheck', 'approve with nits'];
const KINDS = ['blocker', 'concern', 'nit'];
const STATUSES = ['new', 'still-open', 'fixed', 'superseded'];
const ACCEPTANCE_STATUSES = ['pass', 'fail', 'deferred'];
for (const k of ['issue', 'title', 'round', 'reviewedCommit', 'verdict', 'justification']) {
	if (r[k] === undefined || r[k] === '') err(`missing field: ${k}`);
}
if (!VERDICTS.includes(r.verdict)) err(`verdict must be one of ${VERDICTS.join(' | ')}`);
r.findings ??= [];
r.acceptance ??= [];
r.readingOrder ??= [];
r.keyHunks ??= [];
r.testGaps ??= [];
r.questions ??= [];
for (const k of ['findings', 'acceptance', 'readingOrder', 'keyHunks', 'testGaps', 'questions']) {
	if (!Array.isArray(r[k])) {
		err(`${k} must be an array`);
		r[k] = [];
	}
}

if (r.reviewedCommit) {
	try {
		execFileSync('git', ['rev-parse', '--verify', '--quiet', `${r.reviewedCommit}^{commit}`], {
			stdio: 'ignore',
		});
	} catch {
		err(`reviewedCommit ${r.reviewedCommit} is not a commit in this repository`);
	}
}
for (const [i, a] of r.acceptance.entries()) {
	if (!a.criterion) err(`acceptance[${i}]: criterion is required`);
	if (!ACCEPTANCE_STATUSES.includes(a.status))
		err(`acceptance[${i}]: status must be ${ACCEPTANCE_STATUSES.join(' | ')}`);
}

const fileCache = new Map();
function fileLines(path) {
	if (!fileCache.has(path)) {
		let lines = null;
		try {
			const text = execFileSync('git', ['show', `${r.reviewedCommit}:${path}`], {
				encoding: 'utf8',
				maxBuffer: 512 * 1024 * 1024,
				stdio: ['ignore', 'pipe', 'ignore'],
			});
			lines = text.split('\n');
			if (lines.at(-1) === '') lines.pop();
		} catch {
			lines = null;
		}
		fileCache.set(path, lines);
	}
	return fileCache.get(path);
}
function checkRange(where, o, required) {
	if (!o.path) {
		if (required) err(`${where}: path is required`);
		return;
	}
	const lines = fileLines(o.path);
	if (!lines) return err(`${where}: ${o.path} does not exist at ${r.reviewedCommit}`);
	const { startLine: s, endLine: e } = o;
	if (!Number.isInteger(s) || !Number.isInteger(e) || s < 1 || e < s || e > lines.length) {
		err(`${where}: lines ${s}-${e} out of range for ${o.path} (${lines.length} lines)`);
	}
}

const seen = new Set();
for (const f of r.findings) {
	const w = `finding ${f.id}`;
	const m = /^R(\d+)-([BN])(\d+)$/.exec(f.id ?? '');
	if (!m) err(`${w}: id must look like R<round>-B<n> or R<round>-N<n>`);
	else {
		if (Number(m[1]) > r.round) err(`${w}: round prefix is later than the current round`);
		if ((f.kind === 'blocker') !== (m[2] === 'B'))
			err(`${w}: B ids are for blockers only; N for concerns/nits`);
	}
	if (seen.has(f.id)) err(`${w}: duplicate id`);
	seen.add(f.id);
	if (!KINDS.includes(f.kind)) err(`${w}: kind must be ${KINDS.join(' | ')}`);
	if (!STATUSES.includes(f.status)) err(`${w}: status must be ${STATUSES.join(' | ')}`);
	const open = f.status === 'new' || f.status === 'still-open';
	if (open) {
		checkRange(w, f, f.kind === 'blocker');
		for (const k of ['title', 'what', 'why', 'fix']) if (!f[k]) err(`${w}: missing ${k}`);
		if (f.kind === 'blocker' && !f.repro) err(`${w}: blockers need a repro`);
	} else if (!f.evidence) err(`${w}: status ${f.status} needs evidence`);
}
for (const [i, h] of r.readingOrder.entries()) checkRange(`readingOrder[${i}]`, h, true);
for (const [i, h] of r.keyHunks.entries()) checkRange(`keyHunks[${i}]`, h, true);
if (r.keyHunks.length > 8) err('keyHunks: at most 8');

const isOpen = (f) => f.status === 'new' || f.status === 'still-open';
const open = r.findings.filter(isOpen);
const needsAction = open.some((f) => f.kind !== 'nit');
if (r.verdict === 'approve with nits' && needsAction)
	err('verdict approve with nits, but a blocker/concern is open');
if ((r.verdict === 'block' || r.verdict === 'fix-and-recheck') && !needsAction) {
	err(`verdict ${r.verdict}, but no open blocker/concern`);
}
if (errors.length) {
	console.error(`review.json invalid (${errors.length}):\n- ${errors.join('\n- ')}`);
	process.exit(1);
}

// ---------- slices from git ----------
const range = `${base}..${r.reviewedCommit}`;
const raw = git(
	'log',
	'--reverse',
	'--format=%H%x1f%h%x1f%s%x1f%(trailers:key=Slice,valueonly,separator=)%x1f%(trailers:key=Kind,valueonly,separator=)%x1e',
	range,
);
const slices = raw
	.split('\x1e')
	.map((s) => s.trim())
	.filter(Boolean)
	.map((rec) => {
		const [sha, short, subject, slice, kind] = rec.split('\x1f').map((x) => x.trim());
		let added = 0;
		let removed = 0;
		for (const line of git('show', '--numstat', '--format=', '--no-renames', sha).split('\n')) {
			const [a, d, p] = line.split('\t');
			if (!p || p.startsWith('.ai/') || p.endsWith('package-lock.json') || a === '-') continue;
			added += Number(a);
			removed += Number(d);
		}
		return { sha, short, subject, slice: slice || '—', kind: kind || 'unknown', added, removed };
	});

// ---------- markdown ----------
const lang = (p) =>
	({ ts: 'ts', js: 'js', mjs: 'js', svelte: 'svelte', py: 'python', md: 'md', json: 'json' })[
		p.split('.').pop()
	] ?? '';
const quote = (h) => {
	const lines = fileLines(h.path).slice(h.startLine - 1, Math.min(h.endLine, h.startLine + 14));
	return '```' + lang(h.path) + '\n' + lines.join('\n') + '\n```';
};
const loc = (o) =>
	`\`${o.path}:${o.startLine}${o.endLine !== o.startLine ? `-${o.endLine}` : ''}\``;
const fence = (t) => '```\n' + String(t).replace(/```/g, "'''") + '\n```';
const finding = (f) =>
	[
		`### ${f.id} — ${f.title}`,
		'',
		`${f.path ? loc(f) : ''}${f.slice ? ` · slice ${f.slice}` : ''}${f.kind === 'nit' ? ' · nit' : ''}`.trim(),
		'',
		`**What:** ${f.what}`,
		'',
		`**Why it matters:** ${f.why}`,
		'',
		`**Fix:** ${f.fix}`,
		...(f.repro ? ['', '**Repro:**', fence(f.repro)] : []),
	].join('\n');

const byKind = (...k) => open.filter((f) => k.includes(f.kind));
const prior = r.findings.filter((f) => Number(/^R(\d+)/.exec(f.id)[1]) < r.round);

function body(withHunks) {
	const out = [];
	out.push(`<!-- noisy-text-review: round=${r.round} -->`, '');
	out.push(`# Review: Issue #${r.issue} — ${r.title}`, '');
	out.push(`- Round: ${r.round}`);
	out.push(`- Reviewed commit: \`${r.reviewedCommit}\``);
	out.push(`- Verdict: \`${r.verdict}\` — ${r.justification}`);
	out.push(
		`- Open findings: ${open.length ? `\`${open.map((f) => f.id).join(', ')}\`` : 'none'}`,
		'',
	);
	out.push('## Blockers', '');
	out.push(byKind('blocker').length ? byKind('blocker').map(finding).join('\n\n') : 'None.', '');
	out.push('## Non-blocking concerns', '');
	out.push(
		byKind('concern', 'nit').length ? byKind('concern', 'nit').map(finding).join('\n\n') : 'None.',
		'',
	);
	out.push('## Previous findings status', '');
	out.push(
		r.round === 1
			? '- No previous findings (round 1).'
			: prior.length
				? prior.map((f) => `- ${f.id}: ${f.status} — ${f.evidence ?? f.title}`).join('\n')
				: '- No previous findings recorded.',
		'',
	);
	out.push(
		'## Missing tests and verification gaps',
		'',
		r.testGaps.map((t) => `- ${t}`).join('\n') || '- None.',
		'',
	);
	out.push(
		'## Open questions for the author',
		'',
		r.questions.map((t) => `- ${t}`).join('\n') || '- None.',
		'',
	);
	out.push(
		'<details><summary>Orientation: slices, acceptance criteria, reading order, key hunks</summary>',
		'',
	);
	out.push('### Slices', '');
	out.push(
		slices
			.map(
				(s) => `- \`${s.slice}\` \`${s.short}\` ${s.kind} +${s.added}/-${s.removed} — ${s.subject}`,
			)
			.join('\n') || '- No commits in range.',
		'',
	);
	out.push('### Acceptance criteria', '');
	out.push(
		r.acceptance.map((a) => `- ${a.criterion} — **${a.status}**: ${a.evidence ?? ''}`).join('\n') ||
			'- None.',
		'',
	);
	out.push('### Reading order', '');
	out.push(
		r.readingOrder.map((h, i) => `${i + 1}. ${loc(h)} — ${h.why}`).join('\n') || '- None.',
		'',
	);
	if (r.diagram) out.push('### Flow', '', '```mermaid', r.diagram.trim(), '```', '');
	out.push('### Annotated key hunks', '');
	if (!withHunks)
		out.push('_Omitted to fit the comment size limit; see the local `review.html`._', '');
	else
		out.push(
			r.keyHunks
				.map((h) => `#### ${loc(h)}${h.slice ? ` (${h.slice})` : ''}\n\n${quote(h)}\n\n${h.note}`)
				.join('\n\n') || '- None.',
			'',
		);
	out.push('</details>', '');
	return out.join('\n');
}
let md = body(true);
if (md.length > 60000) md = body(false);

// ---------- html ----------
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const hue = (i) => (i * 47) % 360;
const sections = slices.map((s, i) => {
	const diff = git('show', '--format=', '-U3', '--no-renames', s.sha)
		.split('\n')
		.map((l) => {
			const c =
				l.startsWith('+++') || l.startsWith('---') || l.startsWith('diff ')
					? 'meta'
					: l.startsWith('@@')
						? 'hunk'
						: l[0] === '+'
							? 'add'
							: l[0] === '-'
								? 'del'
								: '';
			return `<div class="l ${c}">${esc(l) || ' '}</div>`;
		})
		.join('');
	const mech = s.kind === 'mechanical';
	return `<details id="c${i}" ${mech ? '' : 'open'} style="--h:${hue(i)}"><summary><b>${esc(s.slice)}</b> <code>${s.short}</code> ${esc(s.kind)} +${s.added}/-${s.removed} — ${esc(s.subject)}</summary><pre>${diff}</pre></details>`;
});
const side = slices
	.map(
		(s, i) =>
			`<a href="#c${i}" style="--h:${hue(i)}">${esc(s.slice)} ${esc(s.subject.slice(0, 48))}</a>`,
	)
	.join('');
const fhtml = open
	.map(
		(f) =>
			`<li><b>${f.id}</b> ${esc(f.title)} <code>${f.path ? esc(`${f.path}:${f.startLine}-${f.endLine}`) : ''}</code> <em>${esc(f.kind)}</em></li>`,
	)
	.join('');
const html = `<!doctype html><meta charset="utf-8"><title>Review #${r.issue} r${r.round}</title>
<style>
:root{--bg:#fff;--fg:#1b1f24;--mut:#6a737d;--add:#e6ffec;--del:#ffebe9;--hunk:#ddf4ff}
@media(prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--mut:#8b949e;--add:#12261e;--del:#2d1215;--hunk:#0c2d4a}}
body{margin:0;display:flex;background:var(--bg);color:var(--fg);font:14px system-ui,sans-serif}
nav{position:sticky;top:0;align-self:flex-start;max-height:100vh;overflow:auto;width:280px;padding:12px;box-sizing:border-box}
nav a{display:block;padding:4px 8px;margin:2px 0;border-left:6px solid hsl(var(--h) 70% 50%);color:var(--fg);text-decoration:none;font-size:12px}
main{flex:1;min-width:0;padding:12px 16px}
details{margin:10px 0;border-left:6px solid hsl(var(--h) 70% 50%);padding-left:8px}
summary{cursor:pointer;padding:6px 0}
pre{margin:0;overflow-x:auto;font:12px ui-monospace,monospace}
.l{white-space:pre;padding:0 6px}.add{background:var(--add)}.del{background:var(--del)}.hunk{background:var(--hunk);color:var(--mut)}.meta{color:var(--mut);font-weight:600}
</style>
<nav><b>Slices</b>${side}</nav>
<main><h2>#${r.issue} ${esc(r.title)} — round ${r.round}: ${esc(r.verdict)}</h2><p>${esc(r.justification)}</p>
<h3>Open findings</h3><ul>${fhtml || '<li>none</li>'}</ul><h3>Commits</h3>${sections.join('')}</main>`;

const dir = dirname(jsonPath);
writeFileSync(join(dir, 'review.md'), md);
writeFileSync(join(dir, 'review.html'), html);
process.stdout.write(
	`ok ${join(dir, 'review.md')} (${md.length} chars), ${join(dir, 'review.html')}; ${slices.length} commits, ${open.length} open findings\n`,
);
