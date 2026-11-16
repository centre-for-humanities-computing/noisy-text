#!/usr/bin/env node
// Run the "verify" commands from .omhu.json in order.
//
// This is the one runner an agent permission can pin: no arguments, no
// independent loop. slice-check.mjs imports runVerify so the gate is the same
// whether a slice or a review runs it.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { loadConfig } from './forge.mjs';

export const EXIT = { ok: 0, fail: 1 };

export function runVerify({ cwd = process.cwd(), env = process.env } = {}) {
	let config;
	try {
		config = loadConfig(cwd);
	} catch (error) {
		return { code: EXIT.fail, stdout: '', stderr: `verify: ${error.message}\n` };
	}
	if (!Array.isArray(config.verify) || config.verify.some((command) => typeof command !== 'string' || !command.trim())) {
		return { code: EXIT.fail, stdout: '', stderr: 'verify: "verify" in .omhu.json must be a list of commands\n' };
	}
	if (config.verify.length === 0) {
		return { code: EXIT.ok, stdout: 'verify: no automated gate ("verify" is empty)\n', stderr: '' };
	}

	for (const command of config.verify) {
		const result = spawnSync(command, [], {
			cwd,
			env,
			shell: true,
			encoding: 'utf8',
			stdio: ['inherit', 'inherit', 'inherit']
		});
		if (result.error) {
			return { code: EXIT.fail, stdout: '', stderr: `verify: ${command} could not run: ${result.error.message}\n` };
		}
		if (result.status !== 0) {
			return { code: EXIT.fail, stdout: '', stderr: `verify failed: ${command}\n` };
		}
	}
	return { code: EXIT.ok, stdout: '', stderr: '' };
}

export function main() {
	const result = runVerify();
	if (result.stdout) process.stdout.write(result.stdout);
	if (result.stderr) process.stderr.write(result.stderr);
	process.exitCode = result.code;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
