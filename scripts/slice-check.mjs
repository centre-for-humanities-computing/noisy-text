#!/usr/bin/env node
// Per-slice gate: runs the verification sequence, stages everything, and checks
// the slice size against its budget.
//
//   node scripts/slice-check.mjs [--budget 400]
//
// Exit 0: green and within 1.25x budget (warns between 1.0x and 1.25x).
// Exit 1: a verification step failed (tail of its output is printed).
// Exit 2: green but more than 25% over budget; split the slice.
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const bi = args.indexOf('--budget');
const budget = bi >= 0 ? Number(args[bi + 1]) : 400;
if (!Number.isFinite(budget) || budget <= 0) {
	console.error('usage: node scripts/slice-check.mjs [--budget <lines>]');
	process.exit(1);
}

function run(cmd, cmdArgs) {
	const res = spawnSync(cmd, cmdArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
	return { status: res.status ?? 1, out: `${res.stdout ?? ''}${res.stderr ?? ''}` };
}

for (const step of ['check', 'lint', 'format', 'test']) {
	const { status, out } = run('npm', ['run', step, '--silent']);
	if (status !== 0) {
		console.error(`FAIL  npm run ${step}\n${out.split('\n').slice(-40).join('\n')}`);
		process.exit(1);
	}
	process.stdout.write(`ok    npm run ${step}\n`);
}

// `format` may have rewritten files, so stage only after it ran. Exclude `.ai/`:
// review staging files are gitignored and must never enter a slice commit.
run('git', ['add', '-A', '--', '.', ':!.ai']);
const { out } = run('git', ['diff', '--cached', '--numstat', '--no-renames']);
let added = 0;
let removed = 0;
let files = 0;
for (const line of out.split('\n')) {
	const [a, d, path] = line.split('\t');
	if (!path || path.startsWith('.ai/') || path.endsWith('package-lock.json')) continue;
	if (a === '-') continue; // binary
	added += Number(a);
	removed += Number(d);
	files++;
}
const total = added + removed;
const ratio = total / budget;
const verdict =
	ratio > 1.25 ? 'OVER (split the slice)' : ratio > 1 ? 'slightly over' : 'within budget';
process.stdout.write(
	`size  +${added}/-${removed} = ${total} lines in ${files} files; budget ${budget}: ${verdict}\n`,
);
process.exit(ratio > 1.25 ? 2 : 0);
