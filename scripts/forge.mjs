#!/usr/bin/env node
// Forge-neutral issue and pull-request operations.
//
// The adapter is intentionally dependency-free: Forgejo and GitHub REST use
// Node's built-in fetch, and GitHub may also use an authenticated `gh`.
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export class ForgeError extends Error {
	constructor(message, { code = 'error', status = 1, cause } = {}) {
		super(message, { cause });
		this.name = 'ForgeError';
		this.code = code;
		this.status = status;
	}
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

export function parseRemote(remote) {
	if (typeof remote !== 'string') return null;
	const value = remote.trim();
	if (!value) return null;

	// scp-like: git@host:owner/repo.git (and host:owner/repo.git).
	const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(.+)$/.exec(value);
	if (scp && !/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
		return splitRepo(scp[1], scp[2]);
	}

	let url;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if (!/^(https?|ssh|git\+ssh|git):$/.test(url.protocol)) return null;
	return splitRepo(url.hostname, url.pathname);
}

function splitRepo(host, pathname) {
	const clean = pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
	const parts = clean.split('/').filter(Boolean);
	if (parts.length < 2) return null;
	const owner = parts.at(-2);
	const repo = parts.at(-1);
	if (!host || !owner || !repo) return null;
	return { host: host.toLowerCase(), owner, repo };
}

function normalizeHost(host) {
	if (typeof host !== 'string' || !host.trim()) return null;
	const value = host.trim();
	try {
		const url = new URL(value.includes('://') ? value : `https://${value}`);
		const path = url.pathname.replace(/\/+$/g, '');
		return {
			host: url.hostname.toLowerCase(),
			webBase: `${url.protocol === 'http:' ? 'http' : 'https'}://${url.host}${path}`
		};
	} catch {
		return null;
	}
}

function remoteUrl({ cwd, remote, gitRun }) {
	const run = gitRun ?? ((args) => spawnSync('git', args, { cwd, encoding: 'utf8' }));
	const result = run(['remote', 'get-url', remote]);
	if (!result || result.status !== 0) return null;
	return String(result.stdout ?? '').trim() || null;
}

export function loadConfig(cwd = process.cwd()) {
	const path = join(cwd, '.omhu.json');
	if (!existsSync(path)) return {};
	try {
		const config = JSON.parse(readFileSync(path, 'utf8'));
		return isPlainObject(config) ? config : {};
	} catch (error) {
		throw new ForgeError(`cannot read .omhu.json: ${error.message}`, { code: 'config', status: 2 });
	}
}

export function loadForgeConfig(cwd = process.cwd()) {
	const { forge } = loadConfig(cwd);
	return isPlainObject(forge) ? forge : {};
}

export function tokenEnvFor(kind, cfg = {}) {
	if (kind === 'forgejo') return cfg.tokenEnv || 'FORGEJO_TOKEN';
	if (kind === 'github') return cfg.tokenEnv || 'GITHUB_TOKEN';
	return null;
}

export function resolveForge({ cwd = process.cwd(), cfg = {}, env = process.env, gitRun } = {}) {
	const forge = isPlainObject(cfg) && Object.hasOwn(cfg, 'forge')
		? (isPlainObject(cfg.forge) ? cfg.forge : {})
		: (isPlainObject(cfg) ? cfg : {});
	const kind = forge.kind ?? null;
	if (kind !== null && !['github', 'forgejo'].includes(kind)) {
		throw new ForgeError(`invalid forge.kind "${kind}" (expected github, forgejo, or null)`, { code: 'config', status: 2 });
	}

	const remote = forge.remote || 'origin';
	const remoteValue = remoteUrl({ cwd, remote, gitRun });
	const parsed = parseRemote(remoteValue);
	const configuredHost = normalizeHost(forge.host);

	let resolvedKind = kind;
	if (!resolvedKind) {
		if (configuredHost) resolvedKind = configuredHost.host === 'github.com' ? 'github' : 'forgejo';
		else if (parsed) resolvedKind = parsed.host === 'github.com' ? 'github' : 'forgejo';
	}
	if (!resolvedKind) {
		throw new ForgeError(`cannot detect a forge: set forge.host (remote "${remote}" was not found)`, {
			code: 'config', status: 2
		});
	}

	const hostInfo = configuredHost
		? configuredHost
		: parsed
			? { host: parsed.host, webBase: `https://${parsed.host}` }
			: null;
	if (!hostInfo) {
		throw new ForgeError(`cannot detect a forge host: set forge.host (remote "${remote}" was not found)`, {
			code: 'config', status: 2
		});
	}

	const host = hostInfo.host;
	const webBase = hostInfo.webBase.replace(/\/+$/g, '');
	let apiBase;
	if (resolvedKind === 'forgejo') {
		apiBase = /\/api\/v1$/.test(webBase) ? webBase : `${webBase}/api/v1`;
	} else {
		apiBase = host === 'github.com' ? 'https://api.github.com' : `${webBase}/api/v3`;
	}

	return {
		kind: resolvedKind,
		host,
		owner: parsed?.owner ?? null,
		repo: parsed?.repo ?? null,
		webBase,
		apiBase,
		remote,
		tokenEnv: tokenEnvFor(resolvedKind, forge),
		tokenFile: forge.tokenFile ?? null
	};
}

export function resolveToken(forge, env = {}, cwd = process.cwd()) {
	const fromEnv = forge?.tokenEnv ? env[forge.tokenEnv] : null;
	if (fromEnv) return fromEnv;
	if (!forge?.tokenFile) return null;
	try {
		return readFileSync(resolve(cwd, forge.tokenFile), 'utf8').trim() || null;
	} catch {
		return null;
	}
}

export const EXIT = { ok: 0, operation: 1, usage: 2, auth: 3, notFound: 4 };

const VALUE_FLAGS = new Set(['--body-file', '--title', '--head', '--base', '--label', '--milestone', '--remote', '--state']);
const BOOLEAN_FLAGS = new Set(['--json', '--help', '-h']);

export function parseArgs(argv = []) {
	const positionals = [];
	const flags = {};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (BOOLEAN_FLAGS.has(arg)) {
			if (arg === '--json') flags.json = true;
			else flags.help = true;
			continue;
		}
		if (arg.startsWith('--')) {
			if (!VALUE_FLAGS.has(arg)) throw new ForgeError(`unknown option ${arg}`, { code: 'usage', status: EXIT.usage });
			const value = argv[i + 1];
			if (value === undefined || value.startsWith('--')) {
				throw new ForgeError(`${arg} requires a value`, { code: 'usage', status: EXIT.usage });
			}
			i += 1;
			if (arg === '--label') (flags.label ??= []).push(value);
			else flags[arg.slice(2)] = value;
			continue;
		}
		if (arg.startsWith('-') && arg !== '-') {
			throw new ForgeError(`unknown option ${arg}`, { code: 'usage', status: EXIT.usage });
		}
		positionals.push(arg);
	}
	return { positionals, ...flags, json: Boolean(flags.json), help: Boolean(flags.help) };
}

export function usage() {
	return `Usage: node scripts/forge.mjs [--json] <command> [options]

Commands:
  issue get <number>
  issue search <query>
  issue create --title <t> --body-file <path> [--label <name>]... [--milestone <title>]
  issue edit <number> [--title <t>] --body-file <path> [--label <name>]... [--milestone <title>]
  issue comment <number> --body-file <path>
  milestone list [--state open|closed|all]  (default: open)
  milestone create --title <t>
  pr find --head <branch> [--state open|closed|all]  (default: open)
  pr get <number>
  pr commits <number>
  pr create --base <b> --head <h> --title <t> --body-file <path>
  pr comment <number> --body-file <path>
  pr checks <number>

Options:
  --json   print machine-readable JSON on stdout; warnings/instructions on stderr
  --help   show this help

Exit codes:
  0 success or status reported (including pr checks fail/pending/unknown)
  1 forge/API operation failed
  2 usage, invalid config, or no detectable forge
  3 credentials missing or rejected
  4 issue or pull request not found`;
}

export function redact(value, tokens) {
	let text = String(value ?? '');
	const list = Array.isArray(tokens) ? tokens.filter(Boolean) : (tokens ? [tokens] : []);
	for (const token of list) text = text.split(token).join('[redacted]');
	return text.replace(/\b(Bearer|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, '$1 [redacted]');
}

export function normalizeError(error, tokens) {
	if (error instanceof ForgeError) {
		return new ForgeError(redact(error.message, tokens), { code: error.code, status: error.status, cause: error.cause });
	}
	return new ForgeError(redact(error?.message ?? error, tokens), { code: 'operation', status: EXIT.operation, cause: error });
}

export async function request(url, {
	method = 'GET', token, tokenScheme = 'Bearer', headers = {}, body, fetchImpl = globalThis.fetch
} = {}) {
	if (typeof fetchImpl !== 'function') {
		throw new ForgeError('fetch is not available in this Node runtime', { code: 'operation', status: EXIT.operation });
	}
	const requestHeaders = { Accept: 'application/json', ...headers };
	if (token) requestHeaders.Authorization = `${tokenScheme} ${token}`;
	let response;
	try {
		response = await fetchImpl(url, {
			method,
			headers: requestHeaders,
			body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
		});
	} catch (error) {
		throw normalizeError(error, token);
	}
	const text = await response.text();
	let parsed = text;
	if (text) {
		try {
			parsed = JSON.parse(text);
		} catch {
			parsed = text;
		}
	} else {
		parsed = null;
	}
	if (!response.ok) {
		const status = response.status;
		const detail = typeof parsed === 'string' ? parsed : (parsed?.message ?? parsed?.error ?? response.statusText);
		const message = redact(`${method} ${url} failed (${status}): ${detail ?? 'request failed'}`, token);
		const code = status === 401 || status === 403 ? 'auth' : status === 404 ? 'not-found' : 'operation';
		throw new ForgeError(message, {
			code,
			status: status === 401 || status === 403 ? EXIT.auth : status === 404 ? EXIT.notFound : EXIT.operation
		});
	}
	return parsed;
}

function repoPath(forge) {
	if (!forge.owner || !forge.repo) {
		throw new ForgeError('the forge remote must include an owner and repository', { code: 'config', status: EXIT.usage });
	}
	return `${forge.apiBase}/repos/${encodeURIComponent(forge.owner)}/${encodeURIComponent(forge.repo)}`;
}

function requireToken(token, forge) {
	if (!token) {
		throw new ForgeError(`${forge.tokenEnv ?? 'forge token'} is not set`, { code: 'auth', status: EXIT.auth });
	}
	return token;
}

async function paginate(fetchPage, limit = 50) {
	const out = [];
	for (let page = 1; ; page += 1) {
		const batch = await fetchPage(page);
		if (!Array.isArray(batch)) throw new ForgeError('forge returned a non-list page', { code: 'operation', status: EXIT.operation });
		out.push(...batch);
		if (batch.length < limit) return out;
	}
}

function forgejoRequest(forge, token, path, { method = 'GET', body, fetchImpl } = {}) {
	const headers = { Accept: 'application/json' };
	if (body !== undefined) headers['Content-Type'] = 'application/json';
	return request(`${repoPath(forge)}${path}`, {
		method, token, tokenScheme: 'token', headers, body, fetchImpl
	});
}

function mapComment(comment) {
	return {
		author: comment.user?.login ?? comment.user?.username ?? '',
		body: comment.body ?? '',
		createdAt: comment.created_at ?? ''
	};
}

function mapIssue(issue, comments = []) {
	return {
		number: issue.number,
		title: issue.title ?? '',
		body: issue.body ?? '',
		state: issue.state ?? 'open',
		labels: (issue.labels ?? []).map((label) => typeof label === 'string' ? label : label.name).filter(Boolean),
		milestone: issue.milestone?.title ?? null,
		author: issue.user?.login ?? issue.user?.username ?? '',
		url: issue.html_url ?? '',
		comments: comments.map(mapComment)
	};
}

function mapMilestone(row) {
	return {
		number: row.number ?? row.id,
		title: row.title ?? '',
		state: String(row.state ?? 'open').toLowerCase(),
		due: row.due_on ?? null
	};
}

// Labels and milestones are typed by name in prompts but addressed by id in
// the Forgejo API. Fetch the collection once, match by name, and refuse an
// unknown one before any mutation.
async function forgejoNamedIds(forge, token, path, names, fetchImpl) {
	if (!names?.length) return undefined;
	const separator = path.includes('?') ? '&' : '?';
	const all = await paginate(async (page) => forgejoRequest(
		forge, token, `${path}${separator}limit=50&page=${page}`, { fetchImpl }
	));
	const byName = new Map(all.map((thing) => [thing.name ?? thing.title, thing.id]));
	const ids = [];
	for (const name of names) {
		if (!byName.has(name)) {
			throw new ForgeError(`"${name}" does not exist on ${forge.owner}/${forge.repo}`, { code: 'not-found', status: EXIT.notFound });
		}
		ids.push(byName.get(name));
	}
	return ids;
}

async function forgejoMilestoneId(forge, token, milestone, fetchImpl) {
	if (/^\d+$/.test(String(milestone).trim())) return Number(milestone);
	const [id] = await forgejoNamedIds(forge, token, '/milestones?state=all', [milestone], fetchImpl);
	return id;
}

const forgejoIssueVerbs = {
	async issueGet({ number }, { forge, token, fetchImpl }) {
		requireToken(token, forge);
		const issue = await forgejoRequest(forge, token, `/issues/${number}`, { fetchImpl });
		const comments = await paginate(async (page) => forgejoRequest(
			forge, token, `/issues/${number}/comments?limit=50&page=${page}`, { fetchImpl }
		));
		return mapIssue(issue, comments);
	},

	async issueSearch({ query }, { forge, token, fetchImpl }) {
		requireToken(token, forge);
		const items = await paginate(async (page) => forgejoRequest(
			forge, token, `/issues?state=all&type=issues&q=${encodeURIComponent(query)}&limit=50&page=${page}`, { fetchImpl }
		));
		return items
			.filter((issue) => !issue.pull_request)
			.map((issue) => ({
				number: issue.number, title: issue.title ?? '', state: issue.state ?? 'open', url: issue.html_url ?? ''
			}));
	},

	async issueCreate({ title, body, labels, milestone }, { forge, token, fetchImpl }) {
		requireToken(token, forge);
		const labelIds = await forgejoNamedIds(forge, token, '/labels', labels, fetchImpl);
		const payload = { title, body };
		if (labelIds) payload.labels = labelIds;
		if (milestone !== null) payload.milestone = await forgejoMilestoneId(forge, token, milestone, fetchImpl);
		const issue = await forgejoRequest(forge, token, '/issues', { method: 'POST', body: payload, fetchImpl });
		return { number: issue.number, title: issue.title ?? title, url: issue.html_url ?? '' };
	},

	async issueEdit({ number, title, body, labels, milestone }, { forge, token, fetchImpl }) {
		requireToken(token, forge);
		const payload = { body };
		if (title) payload.title = title;
		const labelIds = await forgejoNamedIds(forge, token, '/labels', labels, fetchImpl);
		if (labelIds) payload.labels = labelIds;
		if (milestone !== null) payload.milestone = await forgejoMilestoneId(forge, token, milestone, fetchImpl);
		const issue = await forgejoRequest(forge, token, `/issues/${number}`, { method: 'PATCH', body: payload, fetchImpl });
		return { number: issue.number, title: issue.title ?? title ?? '', url: issue.html_url ?? '' };
	},

	async issueComment({ number, body }, { forge, token, fetchImpl }) {
		requireToken(token, forge);
		const comment = await forgejoRequest(forge, token, `/issues/${number}/comments`, {
			method: 'POST', body: { body }, fetchImpl
		});
		return { id: comment.id ?? null, url: comment.html_url ?? null };
	},

	async milestoneList({ state }, { forge, token, fetchImpl }) {
		requireToken(token, forge);
		const rows = await paginate(async (page) => forgejoRequest(
			forge, token, `/milestones?state=${state}&limit=50&page=${page}`, { fetchImpl }
		));
		return rows.map(mapMilestone);
	},

	async milestoneCreate({ title }, { forge, token, fetchImpl }) {
		requireToken(token, forge);
		const row = await forgejoRequest(forge, token, '/milestones', { method: 'POST', body: { title }, fetchImpl });
		return { number: row.id, title: row.title ?? title, url: row.html_url ?? '' };
	},

	async prFind({ head, state }, { forge, token, fetchImpl }) {
		requireToken(token, forge);
		const pulls = await paginate(async (page) => forgejoRequest(
			forge, token, `/pulls?state=${state}&limit=50&page=${page}`, { fetchImpl }
		));
		const match = pickPull(pulls
			.filter((pull) => pull.head?.ref === head)
			.map((pull) => ({
				number: pull.number,
				url: pull.html_url ?? '',
				title: pull.title ?? '',
				state: String(pull.state ?? 'open').toLowerCase(),
				head: pull.head?.ref ?? head,
				base: pull.base?.ref ?? '',
				merged: Boolean(pull.merged) || Boolean(pull.merged_at)
			})), { state });
		return match ? pullSummary(match) : null;
	},

	async prGet({ number }, { forge, token, fetchImpl }) {
		requireToken(token, forge);
		const pull = await forgejoRequest(forge, token, `/pulls/${number}`, { fetchImpl });
		const comments = await paginate(async (page) => forgejoRequest(
			forge, token, `/issues/${number}/comments?limit=50&page=${page}`, { fetchImpl }
		));
		return {
			number: pull.number,
			title: pull.title ?? '',
			body: pull.body ?? '',
			state: pull.state ?? 'open',
			url: pull.html_url ?? '',
			head: pull.head?.ref ?? '',
			base: pull.base?.ref ?? '',
			comments: comments.map(mapComment)
		};
	},

	async prCommits({ number }, { forge, token, fetchImpl }) {
		requireToken(token, forge);
		const commits = await paginate(async (page) => forgejoRequest(
			forge, token, `/pulls/${number}/commits?limit=50&page=${page}`, { fetchImpl }
		));
		return commits.map((commit) => ({
			sha: commit.sha ?? '',
			message: commit.commit?.message ?? ''
		}));
	},

	async prCreate({ base, head, title, body }, { forge, token, fetchImpl }) {
		requireToken(token, forge);
		const pull = await forgejoRequest(forge, token, '/pulls', {
			method: 'POST', body: { base, head, title, body }, fetchImpl
		});
		return { number: pull.number, url: pull.html_url ?? '' };
	},

	async prComment({ number, body }, { forge, token, fetchImpl }) {
		requireToken(token, forge);
		const comment = await forgejoRequest(forge, token, `/issues/${number}/comments`, {
			method: 'POST', body: { body }, fetchImpl
		});
		return { id: comment.id ?? null, url: comment.html_url ?? null };
	},

	async prChecks({ number }, { forge, token, fetchImpl }) {
		requireToken(token, forge);
		const pull = await forgejoRequest(forge, token, `/pulls/${number}`, { fetchImpl });
		const sha = pull.head?.sha;
		if (!sha) return { status: 'unknown', checks: [] };
		// A 404 on the combined status endpoint is a real miss (bad ref or a
		// repository the token cannot see) and must surface as not-found; only
		// an empty status list means "no CI configured" (R1-N1).
		const combined = await forgejoRequest(forge, token, `/commits/${sha}/status`, { fetchImpl });
		const statuses = Array.isArray(combined?.statuses) ? combined.statuses : [];
		if (!statuses.length) return { status: 'unknown', checks: [] };
		const checks = statuses.map((entry) => ({
			name: entry.context ?? entry.name ?? '',
			status: mapCheckStatus(entry.status ?? entry.state),
			url: entry.target_url ?? null
		}));
		return { status: combinedStatus(checks), checks };
	}
};

function mapCheckStatus(value) {
	const state = String(value ?? '').toLowerCase();
	if (state === 'success' || state === 'skipped') return 'pass';
	if (state === 'failure' || state === 'error' || state === 'warning') return 'fail';
	if (state === 'pending' || state === 'running' || state === 'queued') return 'pending';
	return 'unknown';
}

function combinedStatus(checks) {
	// `unknown` is reserved for an empty/absent check list, i.e. "no CI
	// configured" (R1-N2). Once CI reported anything the answer must be
	// definite, so an all-unrecognised list falls back to `fail` — a human
	// looks instead of the reviewer reading it as "no CI" (R2-N3).
	if (checks.some((check) => check.status === 'fail')) return 'fail';
	if (checks.some((check) => check.status === 'pending')) return 'pending';
	if (checks.some((check) => check.status === 'pass')) return 'pass';
	return checks.length ? 'fail' : 'unknown';
}

function execGh(ctx, args, { acceptStatus } = {}) {
	const call = ctx.ghRun ?? ((argv, options) => spawnSync('gh', argv, {
		cwd: ctx.cwd, encoding: 'utf8', ...options
	}));
	let result;
	try {
		result = call(args, { cwd: ctx.cwd });
	} catch (error) {
		throw new ForgeError(`gh is not available: ${error.message}`, { code: 'auth', status: EXIT.auth });
	}
	if (!result || result.error) {
		throw new ForgeError(`gh is not available: ${result?.error?.message ?? 'no result'}`, { code: 'auth', status: EXIT.auth });
	}
	if (result.status !== 0 && !acceptStatus?.(result)) {
		const detail = String(result.stderr || result.stdout || 'gh failed').trim();
		const auth = /auth|login|401|403|not logged/i.test(detail);
		if (auth) {
			throw new ForgeError(detail, { code: 'auth', status: EXIT.auth });
		}
		// Only object-specific misses are "not found"; a transport failure
		// ("Could not resolve host:") or a repository the token cannot see
		// ("Could not resolve to a Repository") is an operation error (R2-N2),
		// and a bare 404 is translated only inside the milestone lookup (R3-N2).
		if (/could not resolve to (?:an? )?(?:issue|pull ?request|milestone)|no (?:issues|pull ?requests|milestones) match/i.test(detail)) {
			throw new ForgeError(detail, { code: 'not-found', status: EXIT.notFound });
		}
		throw new ForgeError(detail, { code: 'operation', status: EXIT.operation });
	}
	return result;
}

export function ghAvailable(ctx) {
	try {
		return execGh(ctx, ['--version']).status === 0;
	} catch {
		return false;
	}
}

function ghJson(ctx, args) {
	const result = execGh(ctx, args);
	const text = String(result.stdout ?? '').trim();
	if (!text) throw new ForgeError(`gh ${args.join(' ')} returned no JSON`, { code: 'operation', status: EXIT.operation });
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new ForgeError(`gh ${args.join(' ')} returned invalid JSON: ${error.message}`, { code: 'operation', status: EXIT.operation });
	}
}

// `gh --milestone` expects the milestone title, while prompts pass the number
// the forge API uses; resolve a numeric value to its title with one direct GET so
// numbers past the first page still work (R3-N1). A 404 here is the one place
// that means "missing milestone"; everywhere else it is an operation error
// (R3-N2), so the translation stays local to this lookup.
async function ghMilestoneName(ctx, milestone) {
	const value = String(milestone ?? '').trim();
	if (!/^\d+$/.test(value)) return value;
	let row;
	try {
		row = ghJson(ctx, ['api', 'repos/{owner}/{repo}/milestones/' + value]);
	} catch (error) {
		if (error instanceof ForgeError && /not found \(http 404\)/i.test(error.message)) {
			throw new ForgeError(`milestone "${value}" does not exist on ${ctx.forge.owner}/${ctx.forge.repo}`, {
				code: 'not-found', status: EXIT.notFound
			});
		}
		throw error;
	}
	return String(row?.title ?? value);
}

function urlNumber(value) {
	const match = /\/(\d+)\/?$/.exec(String(value ?? '').trim());
	return match ? Number(match[1]) : null;
}

// One rule for "which pull belongs to this head", shared by all four adapters
// (R2-N1). With a concrete state the oldest number wins, which is what the
// round workflow has always assumed; `--state all` is /retro looking for the
// round's outcome, so a merged pull outranks a closed one and both outrank a
// still-open one, with the newest number inside each rank.
function pickPull(pulls, { state = 'open' } = {}) {
	const list = pulls.filter(Boolean);
	if (state !== 'all') return [...list].sort((a, b) => Number(a.number) - Number(b.number))[0] ?? null;
	const rank = (pull) => (pull.merged || pull.state === 'merged' ? 3 : pull.state === 'closed' ? 2 : 1);
	return [...list].sort((a, b) => rank(b) - rank(a) || Number(b.number) - Number(a.number))[0] ?? null;
}

function pullSummary(pull) {
	const merged = Boolean(pull.merged) || String(pull.state ?? '').toLowerCase() === 'merged';
	return {
		number: pull.number,
		url: pull.url ?? '',
		title: pull.title ?? '',
		state: merged ? 'merged' : String(pull.state ?? 'open').toLowerCase(),
		head: pull.head ?? '',
		base: pull.base ?? ''
	};
}

function mapGhIssue(issue) {
	return {
		number: issue.number,
		title: issue.title ?? '',
		body: issue.body ?? '',
		state: String(issue.state ?? 'open').toLowerCase(),
		labels: (issue.labels ?? []).map((label) => typeof label === 'string' ? label : label.name).filter(Boolean),
		milestone: issue.milestone?.title ?? null,
		author: issue.author?.login ?? '',
		url: issue.url ?? '',
		comments: (issue.comments ?? []).map((comment) => ({
			author: comment.author?.login ?? '',
			body: comment.body ?? '',
			createdAt: comment.createdAt ?? ''
		}))
	};
}

const ghIssueFields = 'number,title,body,state,labels,milestone,author,url,comments';

// One gh list call returns at most this many rows; the cap is documented in
// docs/forge.md so the gh transport matches the paginating adapters (R1-N13).
const GH_LIST_LIMIT = 1000;

const githubGh = {
	async issueGet({ number }, ctx) {
		return mapGhIssue(ghJson(ctx, ['issue', 'view', String(number), '--json', ghIssueFields]));
	},

	async issueSearch({ query }, ctx) {
		const rows = ghJson(ctx, ['issue', 'list', '--search', query, '--state', 'all', '--limit', String(GH_LIST_LIMIT), '--json', 'number,title,state,url']);
		return rows.map((row) => ({
			number: row.number, title: row.title ?? '', state: String(row.state ?? 'open').toLowerCase(), url: row.url ?? ''
		}));
	},

	async issueCreate({ title, labels, milestone, bodyFile }, ctx) {
		const args = ['issue', 'create', '--title', title, '--body-file', bodyFile];
		for (const label of labels) args.push('--label', label);
		if (milestone !== null) args.push('--milestone', await ghMilestoneName(ctx, milestone));
		const result = execGh(ctx, args);
		const url = String(result.stdout ?? '').trim().split(/\s+/).find((part) => /^https?:\/\//.test(part)) ?? '';
		return { number: urlNumber(url), title, url };
	},

	async issueEdit({ number, title, labels, milestone, bodyFile }, ctx) {
		const args = ['issue', 'edit', String(number), '--body-file', bodyFile];
		if (title) args.push('--title', title);
		for (const label of labels) args.push('--add-label', label);
		if (milestone !== null) args.push('--milestone', await ghMilestoneName(ctx, milestone));
		// Exactly one mutating gh call; `mutated` splits the mutation from the
		// read-back so a post-mutation failure is never mistaken for a failed
		// edit and re-issued over REST (R1-B1).
		let mutated = false;
		try {
			execGh(ctx, args);
			mutated = true;
			const issue = mapGhIssue(ghJson(ctx, ['issue', 'view', String(number), '--json', ghIssueFields]));
			return { number: issue.number, title: issue.title, url: issue.url };
		} catch (error) {
			if (mutated && error instanceof ForgeError) error.noFallback = true;
			throw error;
		}
	},

	async issueComment({ number, bodyFile }, ctx) {
		const result = execGh(ctx, ['issue', 'comment', String(number), '--body-file', bodyFile]);
		const url = String(result.stdout ?? '').trim().split(/\s+/).find((part) => /^https?:\/\//.test(part)) ?? null;
		return { id: null, url };
	},

	async milestoneList({ state }, ctx) {
		const rows = [];
		for (let page = 1; ; page += 1) {
			const batch = ghJson(ctx, ['api', `repos/{owner}/{repo}/milestones?state=${state}&per_page=100&page=${page}`]);
			if (!Array.isArray(batch)) {
				throw new ForgeError('gh milestone list returned a non-list page', { code: 'operation', status: EXIT.operation });
			}
			rows.push(...batch);
			if (batch.length < 100) break;
		}
		return rows.map(mapMilestone);
	},

	async milestoneCreate({ title }, ctx) {
		const row = ghJson(ctx, ['api', 'repos/{owner}/{repo}/milestones', '--method', 'POST', '-f', `title=${title}`]);
		return { number: row.number, title: row.title ?? title, url: row.html_url ?? '' };
	},

	async prFind({ head, state }, ctx) {
		const rows = ghJson(ctx, ['pr', 'list', '--head', head, '--state', state, '--limit', String(GH_LIST_LIMIT), '--json', 'number,url,title,state,headRefName,baseRefName,mergedAt']);
		const match = pickPull(rows.map((row) => ({
			number: row.number,
			url: row.url ?? '',
			title: row.title ?? '',
			state: String(row.state ?? 'open').toLowerCase(),
			head: row.headRefName ?? head,
			base: row.baseRefName ?? '',
			merged: Boolean(row.mergedAt)
		})), { state });
		return match ? pullSummary(match) : null;
	},

	async prGet({ number }, ctx) {
		const pull = ghJson(ctx, ['pr', 'view', String(number), '--json', 'number,title,body,state,url,headRefName,baseRefName,comments']);
		return {
			number: pull.number,
			title: pull.title ?? '',
			body: pull.body ?? '',
			state: String(pull.state ?? 'open').toLowerCase(),
			url: pull.url ?? '',
			head: pull.headRefName ?? '',
			base: pull.baseRefName ?? '',
			comments: (pull.comments ?? []).map((comment) => ({
				author: comment.author?.login ?? '',
				body: comment.body ?? '',
				createdAt: comment.createdAt ?? ''
			}))
		};
	},

	async prCommits({ number }, ctx) {
		const pull = ghJson(ctx, ['pr', 'view', String(number), '--json', 'commits']);
		return (pull.commits ?? []).map((commit) => ({
			sha: commit.oid ?? '',
			message: [commit.messageHeadline, commit.messageBody].filter(Boolean).join('\n\n')
		}));
	},

	async prCreate({ base, head, title, bodyFile }, ctx) {
		const result = execGh(ctx, ['pr', 'create', '--base', base, '--head', head, '--title', title, '--body-file', bodyFile]);
		const url = String(result.stdout ?? '').trim().split(/\s+/).find((part) => /^https?:\/\//.test(part)) ?? '';
		return { number: urlNumber(url), url };
	},

	async prComment({ number, bodyFile }, ctx) {
		const result = execGh(ctx, ['pr', 'comment', String(number), '--body-file', bodyFile]);
		const url = String(result.stdout ?? '').trim().split(/\s+/).find((part) => /^https?:\/\//.test(part)) ?? null;
		return { id: null, url };
	},

	async prChecks({ number }, ctx) {
		// `gh pr checks` exits 1 when a check failed and 8 while checks are
		// pending, still printing the requested JSON; only a run without usable
		// output is a real failure, and that one goes through execGh's
		// auth/not-found/operation classification like every other verb (R1-B3).
		const result = execGh(ctx, ['pr', 'checks', String(number), '--json', 'name,state,bucket,link'], {
			acceptStatus: (check) => String(check.stdout ?? '').trim() !== '' || /no checks reported/i.test(String(check.stderr ?? ''))
		});
		const stdout = String(result.stdout ?? '').trim();
		if (!stdout) return { status: 'unknown', checks: [] };
		let rows;
		try {
			rows = JSON.parse(stdout);
		} catch (error) {
			throw new ForgeError(`gh pr checks returned invalid JSON: ${error.message}`, { code: 'operation', status: EXIT.operation });
		}
		if (!Array.isArray(rows) || !rows.length) return { status: 'unknown', checks: [] };
		const checks = rows.map((row) => ({
			name: row.name ?? '',
			status: mapGhCheck(row.bucket ?? row.state),
			url: row.link ?? null
		}));
		return { status: combinedStatus(checks), checks };
	}
};

function mapGhCheck(value) {
	const state = String(value ?? '').toLowerCase();
	if (state === 'pass' || state === 'success' || state === 'neutral' || state === 'skipping') return 'pass';
	if (state === 'fail' || state === 'failure' || state === 'error' || state === 'cancel') return 'fail';
	if (state === 'pending' || state === 'queued' || state === 'in_progress' || state === 'running') return 'pending';
	return 'unknown';
}

function githubRestRequest(forge, token, path, { method = 'GET', body, fetchImpl } = {}) {
	const headers = {
		Accept: 'application/vnd.github+json',
		'X-GitHub-Api-Version': '2022-11-28'
	};
	if (body !== undefined) headers['Content-Type'] = 'application/json';
	return request(`${repoPath(forge)}${path}`, {
		method, token, tokenScheme: 'Bearer', headers, body, fetchImpl
	});
}

async function githubRestPaginate(fetchPage) {
	return paginate(fetchPage, 100);
}

// GitHub's issue API takes a milestone number, while prompts pass a title.
async function githubRestMilestoneNumber(forge, token, milestone, fetchImpl) {
	const value = String(milestone ?? '').trim();
	if (/^\d+$/.test(value)) return Number(value);
	const all = await githubRestPaginate(async (page) => githubRestRequest(
		forge, token, `/milestones?state=all&per_page=100&page=${page}`, { fetchImpl }
	));
	const match = all.find((row) => row.title === value);
	if (!match) {
		throw new ForgeError(`milestone "${value}" does not exist on ${forge.owner}/${forge.repo}`, { code: 'not-found', status: EXIT.notFound });
	}
	return match.number;
}

const githubRest = {
	async issueGet({ number }, { forge, token, fetchImpl }) {
		requireToken(token, forge);
		const issue = await githubRestRequest(forge, token, `/issues/${number}`, { fetchImpl });
		const comments = await githubRestPaginate(async (page) => githubRestRequest(
			forge, token, `/issues/${number}/comments?per_page=100&page=${page}`, { fetchImpl }
		));
		return mapIssue(issue, comments);
	},

	async issueSearch({ query }, { forge, token, fetchImpl }) {
		requireToken(token, forge);
		const q = `repo:${forge.owner}/${forge.repo} is:issue ${query}`;
		const items = await githubRestPaginate(async (page) => {
			const data = await githubRestRequest(forge, token, `/search/issues?q=${encodeURIComponent(q)}&per_page=100&page=${page}`, { fetchImpl });
			return data.items ?? [];
		});
		return items
			.filter((issue) => !issue.pull_request)
			.map((issue) => ({
				number: issue.number, title: issue.title ?? '', state: String(issue.state ?? 'open').toLowerCase(), url: issue.html_url ?? ''
			}));
	},

	async issueCreate({ title, body, labels, milestone }, { forge, token, fetchImpl }) {
		requireToken(token, forge);
		const payload = { title, body };
		if (labels.length) payload.labels = labels;
		if (milestone !== null) payload.milestone = await githubRestMilestoneNumber(forge, token, milestone, fetchImpl);
		const issue = await githubRestRequest(forge, token, '/issues', { method: 'POST', body: payload, fetchImpl });
		return { number: issue.number, title: issue.title ?? title, url: issue.html_url ?? '' };
	},

	async issueEdit({ number, title, body, labels, milestone }, { forge, token, fetchImpl }) {
		requireToken(token, forge);
		const payload = { body };
		if (title) payload.title = title;
		if (labels.length) payload.labels = labels;
		if (milestone !== null) payload.milestone = await githubRestMilestoneNumber(forge, token, milestone, fetchImpl);
		const issue = await githubRestRequest(forge, token, `/issues/${number}`, { method: 'PATCH', body: payload, fetchImpl });
		return { number: issue.number, title: issue.title ?? title ?? '', url: issue.html_url ?? '' };
	},

	async issueComment({ number, body }, { forge, token, fetchImpl }) {
		requireToken(token, forge);
		const comment = await githubRestRequest(forge, token, `/issues/${number}/comments`, {
			method: 'POST', body: { body }, fetchImpl
		});
		return { id: comment.id ?? null, url: comment.html_url ?? null };
	},

	async milestoneList({ state }, { forge, token, fetchImpl }) {
		requireToken(token, forge);
		const rows = await githubRestPaginate(async (page) => githubRestRequest(
			forge, token, `/milestones?state=${state}&per_page=100&page=${page}`, { fetchImpl }
		));
		return rows.map(mapMilestone);
	},

	async milestoneCreate({ title }, { forge, token, fetchImpl }) {
		requireToken(token, forge);
		const row = await githubRestRequest(forge, token, '/milestones', { method: 'POST', body: { title }, fetchImpl });
		return { number: row.number, title: row.title ?? title, url: row.html_url ?? '' };
	},

	async prFind({ head, state }, { forge, token, fetchImpl }) {
		requireToken(token, forge);
		const pulls = await githubRestPaginate(async (page) => githubRestRequest(
			forge, token, `/pulls?state=${state}&head=${encodeURIComponent(`${forge.owner}:${head}`)}&per_page=100&page=${page}`, { fetchImpl }
		));
		const match = pickPull(pulls
			.filter((pull) => pull.head?.ref === head)
			.map((pull) => ({
				number: pull.number,
				url: pull.html_url ?? '',
				title: pull.title ?? '',
				state: String(pull.state ?? 'open').toLowerCase(),
				head: pull.head?.ref ?? head,
				base: pull.base?.ref ?? '',
				merged: Boolean(pull.merged_at)
			})), { state });
		return match ? pullSummary(match) : null;
	},

	async prGet({ number }, { forge, token, fetchImpl }) {
		requireToken(token, forge);
		const pull = await githubRestRequest(forge, token, `/pulls/${number}`, { fetchImpl });
		const comments = await githubRestPaginate(async (page) => githubRestRequest(
			forge, token, `/issues/${number}/comments?per_page=100&page=${page}`, { fetchImpl }
		));
		return {
			number: pull.number,
			title: pull.title ?? '',
			body: pull.body ?? '',
			state: String(pull.state ?? 'open').toLowerCase(),
			url: pull.html_url ?? '',
			head: pull.head?.ref ?? '',
			base: pull.base?.ref ?? '',
			comments: comments.map(mapComment)
		};
	},

	async prCommits({ number }, { forge, token, fetchImpl }) {
		requireToken(token, forge);
		const commits = await githubRestPaginate(async (page) => githubRestRequest(
			forge, token, `/pulls/${number}/commits?per_page=100&page=${page}`, { fetchImpl }
		));
		return commits.map((commit) => ({
			sha: commit.sha ?? '',
			message: commit.commit?.message ?? ''
		}));
	},

	async prCreate({ base, head, title, body }, { forge, token, fetchImpl }) {
		requireToken(token, forge);
		const pull = await githubRestRequest(forge, token, '/pulls', {
			method: 'POST', body: { base, head, title, body }, fetchImpl
		});
		return { number: pull.number, url: pull.html_url ?? '' };
	},

	async prComment({ number, body }, { forge, token, fetchImpl }) {
		requireToken(token, forge);
		const comment = await githubRestRequest(forge, token, `/issues/${number}/comments`, {
			method: 'POST', body: { body }, fetchImpl
		});
		return { id: comment.id ?? null, url: comment.html_url ?? null };
	},

	async prChecks({ number }, { forge, token, fetchImpl, warnings }) {
		requireToken(token, forge);
		const pull = await githubRestRequest(forge, token, `/pulls/${number}`, { fetchImpl });
		const sha = pull.head?.sha;
		if (!sha) return { status: 'unknown', checks: [] };
		const optional = async (fetcher) => {
			try {
				return await fetcher();
			} catch (error) {
				if (error instanceof ForgeError && error.status === EXIT.notFound) return [];
				throw error;
			}
		};
		// A 404 on page 1 means the ref has no check runs at all; on a later page
		// it only means the listing ended, so the pages already read must
		// survive instead of being discarded by one wrapper (R2-N5). Either a
		// later-page 404 or a short count is a truncated listing and must say so
		// rather than look like a clean pass (R3-N6).
		const runs = [];
		let totalCount = null;
		let missingPage = null;
		for (let page = 1; ; page += 1) {
			let data;
			try {
				data = await githubRestRequest(forge, token, `/commits/${sha}/check-runs?per_page=100&page=${page}`, { fetchImpl });
			} catch (error) {
				if (!(error instanceof ForgeError && error.status === EXIT.notFound)) throw error;
				if (page > 1) missingPage = page;
				break;
			}
			if (!Array.isArray(data?.check_runs)) {
				throw new ForgeError('forge returned a non-list check-runs page', { code: 'operation', status: EXIT.operation });
			}
			if (page === 1 && typeof data.total_count === 'number') totalCount = data.total_count;
			runs.push(...data.check_runs);
			if (data.check_runs.length < 100) break;
		}
		if (missingPage) {
			warnings.push(`check-runs page ${missingPage} is missing; the check list may be incomplete`);
		} else if (totalCount !== null && totalCount > runs.length) {
			warnings.push(`read ${runs.length} of ${totalCount} check runs; the check list may be incomplete`);
		}
		const statuses = await optional(async () => {
			const data = await githubRestRequest(forge, token, `/commits/${sha}/status`, { fetchImpl });
			return data?.statuses ?? [];
		});
		if (!runs.length && !statuses.length) return { status: 'unknown', checks: [] };
		const checks = [
			...runs.map((run) => ({
				name: run.name ?? '',
				status: mapCheckRun(run),
				url: run.html_url ?? run.details_url ?? null
			})),
			...statuses.map((entry) => ({
				name: entry.context ?? '',
				status: mapCheckStatus(entry.state ?? entry.status),
				url: entry.target_url ?? null
			}))
		];
		return { status: combinedStatus(checks), checks };
	}
};

function mapCheckRun(run) {
	if (String(run.status ?? '').toLowerCase() !== 'completed') return 'pending';
	const conclusion = String(run.conclusion ?? '').toLowerCase();
	// `stale` is a completed run GitHub gave up on; gh's own bucket calls that
	// "skipping", so it maps to pass here rather than surfacing as unknown
	// (R2-N3).
	if (conclusion === 'success' || conclusion === 'neutral' || conclusion === 'skipped' || conclusion === 'stale') return 'pass';
	if (['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure'].includes(conclusion)) return 'fail';
	return 'unknown';
}

const githubAdapter = {};

for (const [name, fn] of Object.entries(githubGh)) {
	githubAdapter[name] = async (args, ctx) => {
		if (ghAvailable(ctx)) {
			try {
				return await fn(args, ctx);
			} catch (error) {
				// Fall back to REST only when gh demonstrably could not run the
				// verb (spawn/auth failure); a landed write is marked noFallback
				// by the verb so the failure surfaces instead of a second write
				// over REST (R1-B1).
				if (error?.code !== 'auth' || error?.noFallback || !ctx.token) throw error;
			}
		}
		if (!ctx.token) {
			throw new ForgeError('gh is not installed or not authenticated, and GITHUB_TOKEN is not set', {
				code: 'auth', status: EXIT.auth
			});
		}
		return githubRest[name](args, ctx);
	};
}

export const defaultAdapters = { forgejo: forgejoIssueVerbs, github: githubAdapter };

const COMMANDS = {
	'issue get': 'issueGet',
	'issue search': 'issueSearch',
	'issue create': 'issueCreate',
	'issue edit': 'issueEdit',
	'issue comment': 'issueComment',
	'milestone list': 'milestoneList',
	'milestone create': 'milestoneCreate',
	'pr find': 'prFind',
	'pr get': 'prGet',
	'pr commits': 'prCommits',
	'pr create': 'prCreate',
	'pr comment': 'prComment',
	'pr checks': 'prChecks'
};

function requireNumber(value, label) {
	if (!/^\d+$/.test(value ?? '')) throw new ForgeError(`${label} must be a number`, { code: 'usage', status: EXIT.usage });
	return Number(value);
}

function requireValue(flags, name) {
	if (!flags[name]) throw new ForgeError(`--${name} is required`, { code: 'usage', status: EXIT.usage });
	return flags[name];
}

function stateValue(flags) {
	const state = flags.state ?? 'open';
	if (!['open', 'closed', 'all'].includes(state)) throw new ForgeError(`unknown --state ${state}`, { code: 'usage', status: EXIT.usage });
	return state;
}

function readBody(flags) {
	const path = requireValue(flags, 'body-file');
	try {
		return readFileSync(path, 'utf8');
	} catch (error) {
		throw new ForgeError(`cannot read --body-file ${path}: ${error.message}`, { code: 'usage', status: EXIT.usage });
	}
}

function buildCall(parsed) {
	const { positionals, json, help, ...flags } = parsed;
	if (help) return { help: true, json };
	const [noun, verb, ...rest] = positionals;
	const key = `${noun} ${verb}`;
	const method = COMMANDS[key];
	if (!method) throw new ForgeError(`unknown command "${noun} ${verb ?? ''}"`.trim(), { code: 'usage', status: EXIT.usage });
	// `--state` only means something for a pull or milestone lookup; silently
	// ignoring it on another verb hides a caller bug (R2-N7).
	if (flags.state !== undefined && !['pr find', 'milestone list'].includes(key)) {
		throw new ForgeError('--state is only valid for pr find and milestone list', { code: 'usage', status: EXIT.usage });
	}

	switch (key) {
		case 'issue get':
		case 'pr get':
		case 'pr commits':
		case 'pr checks':
			return { json, method, args: { number: requireNumber(rest[0], 'number') } };
		case 'issue search':
			if (!rest.length) throw new ForgeError('search query is required', { code: 'usage', status: EXIT.usage });
			return { json, method, args: { query: rest.join(' ') } };
		case 'issue create':
			return {
				json,
				method,
				args: {
					title: requireValue(flags, 'title'),
					body: readBody(flags),
					bodyFile: flags['body-file'],
					labels: flags.label ?? [],
					milestone: flags.milestone ?? null
				}
			};
		case 'issue edit':
			return {
				json,
				method,
				args: {
					number: requireNumber(rest[0], 'number'),
					title: flags.title ?? null,
					body: readBody(flags),
					bodyFile: flags['body-file'],
					labels: flags.label ?? [],
					milestone: flags.milestone ?? null
				}
			};
		case 'milestone list':
			return { json, method, args: { state: stateValue(flags) } };
		case 'milestone create':
			return { json, method, args: { title: requireValue(flags, 'title') } };
		case 'issue comment':
		case 'pr comment':
			return {
				json,
				method,
				args: { number: requireNumber(rest[0], 'number'), body: readBody(flags), bodyFile: flags['body-file'] }
			};
		case 'pr find':
			return { json, method, args: { head: requireValue(flags, 'head'), state: stateValue(flags) } };
		case 'pr create':
			return {
				json,
				method,
				args: {
					base: requireValue(flags, 'base'),
					head: requireValue(flags, 'head'),
					title: requireValue(flags, 'title'),
					body: readBody(flags),
					bodyFile: flags['body-file']
				}
			};
		default:
			throw new ForgeError(`unknown command "${key}"`, { code: 'usage', status: EXIT.usage });
	}
}

function human(value) {
	if (value === null) return 'null';
	if (typeof value === 'string') return value;
	return JSON.stringify(value, null, 2);
}

export async function run(argv = [], {
	cwd = process.cwd(), env = process.env, fetchImpl = globalThis.fetch, ghRun, gitRun, adapters = defaultAdapters
} = {}) {
	let parsed;
	let json = argv.includes('--json');
	let forge = null;
	let token = null;
	try {
		parsed = parseArgs(argv);
		json = parsed.json;
		const call = buildCall(parsed);
		if (call.help) return { code: EXIT.ok, stdout: usage(), stderr: '' };
		forge = resolveForge({ cwd, cfg: loadForgeConfig(cwd), env, gitRun });
		token = resolveToken(forge, env, cwd);
		const adapter = adapters[forge.kind];
		if (!adapter) {
			throw new ForgeError(`no ${forge.kind} adapter is available`, { code: 'operation', status: EXIT.operation });
		}
		const warnings = [];
		const value = await adapter[call.method](call.args, {
			forge, env, fetchImpl, ghRun, cwd, token, json: call.json, warnings
		});
		return {
			code: EXIT.ok,
			stdout: json ? JSON.stringify(value) : human(value),
			stderr: warnings.length ? `${warnings.join('\n')}\n` : '',
			value
		};
	} catch (error) {
		const tokens = [token, env?.[forge?.tokenEnv], env?.GITHUB_TOKEN, env?.FORGEJO_TOKEN];
		const normalized = normalizeError(error, tokens);
		const code = normalized.status ?? EXIT.operation;
		if (json) {
			const body = JSON.stringify({ error: { code: normalized.code, message: normalized.message, status: code } });
			return { code, stdout: '', stderr: `${body}\n` };
		}
		return { code, stdout: '', stderr: `${normalized.message}\n` };
	}
}

export function main() {
	const result = run(process.argv.slice(2));
	result.then(({ code, stdout, stderr }) => {
		if (stdout) process.stdout.write(stdout.endsWith('\n') ? stdout : `${stdout}\n`);
		if (stderr) process.stderr.write(stderr);
		process.exitCode = code;
	}).catch((error) => {
		process.stderr.write(`${error.message}\n`);
		process.exitCode = EXIT.operation;
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
