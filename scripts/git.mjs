// Run git and return stdout, or null when it cannot run or exits non-zero.
import { spawnSync } from 'node:child_process';

export function git(cwd, args) {
	const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
	return result.error || result.status !== 0 ? null : result.stdout;
}
