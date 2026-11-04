#!/usr/bin/env node
// Run a slice's verify commands, stage it, and enforce its churn budget.
//
// A slice is the working tree since the last commit. The script stages that
// tree so commits contain exactly the slice, then reports added + deleted
// lines. It never commits.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { loadConfig } from './forge.mjs';

export const EXIT = { ok: 0, fail: 1, budget: 2 };

export function usage() {
	return `Usage: node scripts/slice-check.mjs [--budget <lines>]

Runs the "verify" commands from .omhu.json in order, stages the working tree,
and reports added and deleted churn. An empty list means there is no automated
gate; the slice is still staged. It refuses a dirty index, unstages an
over-budget slice, and never commits.

Options:
  --budget <lines>  maximum churn; defaults to "sliceBudget" in .omhu.json.
  --help            show this help

Exit codes:
  0 verify passed and the slice is within budget
  1 dirty index, invalid config, or a verify command failed
  2 the slice is more than 25% over budget`;
}

export function parseArgs(argv = []) {
	const options = {};
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === '--help' || arg === '-h') {
			options.help = true;
			continue;
		}
		if (arg === '--budget') {
			const value = argv[i + 1];
			if (value === undefined) throw new Error('--budget requires a value');
			options.budget = Number(value);
			if (!Number.isFinite(options.budget) || options.budget < 0) {
				throw new Error('--budget must be a non-negative number');
			}
			i += 1;
			continue;
		}
		throw new Error(`unknown option ${arg}`);
	}
	return options;
}

const fail = (message, code = EXIT.fail) => ({
	code,
	stdout: '',
	stderr: `slice-check: ${message}\n`,
});

function run(command, args, { cwd, env, inherit = false, shell = false } = {}) {
	const result = spawnSync(command, args, {
		cwd,
		env,
		shell,
		encoding: 'utf8',
		stdio: inherit ? ['inherit', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'],
	});
	if (result.error) throw new Error(`${command} could not run: ${result.error.message}`);
	return result;
}

function git(args, { cwd, env } = {}) {
	return run('git', args, { cwd, env });
}

export function runSliceCheck(argv = [], { cwd = process.cwd(), env = process.env } = {}) {
	let options;
	try {
		options = parseArgs(argv);
	} catch (error) {
		return fail(error.message);
	}
	if (options.help) return { code: EXIT.ok, stdout: `${usage()}\n`, stderr: '' };

	let config;
	try {
		config = loadConfig(cwd);
	} catch (error) {
		return fail(error.message);
	}

	const budget = options.budget ?? config.sliceBudget;
	if (!Number.isFinite(budget) || budget < 0) {
		return fail('no budget; pass --budget or set "sliceBudget" in .omhu.json');
	}
	if (
		!Array.isArray(config.verify) ||
		config.verify.some((command) => typeof command !== 'string' || !command.trim())
	) {
		return fail('"verify" in .omhu.json must be a list of commands');
	}
	const gate =
		config.verify.length === 0 ? 'slice-check: no automated gate ("verify" is empty)\n' : '';

	const index = git(['diff', '--cached', '--quiet'], { cwd, env });
	if (index.status !== 0) {
		return fail('the index already has staged changes; commit or unstage them first');
	}

	for (const command of config.verify) {
		const result = run(command, [], { cwd, env, inherit: true, shell: true });
		if (result.status !== 0) return fail(`verify failed: ${command}`);
	}

	const add = git(['add', '-A'], { cwd, env });
	if (add.status !== 0) return fail(`could not stage the working tree\n${add.stderr ?? ''}`);
	const stat = git(['diff', '--cached', '--numstat'], { cwd, env });
	if (stat.status !== 0) return fail(`could not read the staged diff\n${stat.stderr ?? ''}`);

	let added = 0;
	let deleted = 0;
	for (const line of stat.stdout.split('\n')) {
		const [a, d] = line.split('\t');
		if (/^\d+$/.test(a)) added += Number(a);
		if (/^\d+$/.test(d)) deleted += Number(d);
	}
	const churn = added + deleted;
	const limit = Math.floor(budget * 1.25);
	const summary = `slice-check: ${added} added, ${deleted} deleted, ${churn} changed; budget ${budget} (limit ${limit})\n`;
	if (churn > limit) {
		git(['reset', '-q'], { cwd, env });
		return {
			code: EXIT.budget,
			stdout: `${gate}${summary}`,
			stderr: `slice-check: ${churn} changed lines is more than 25% over the ${budget}-line budget\n`,
		};
	}
	return { code: EXIT.ok, stdout: `${gate}${summary}`, stderr: '' };
}

export function main() {
	const result = runSliceCheck(process.argv.slice(2));
	if (result.stdout) process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(result.stderr);
	process.exitCode = result.code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
