import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decide, parsePlanSlices } from './slice-pack.mjs';

const PLAN = `# Plan

Intro.

## Slices

### S1 — Do the first thing

- Kind: behav-
  ioral
- Budget: 12-
  0 changed lines
- Files: \`src/a.ts\` (create), \`src/b.ts\` (modify) — a
  wrapped continuation.
- Tests: \`src/a.test.ts\` — covers it.
- Covers: AC1
- Commit: \`feat(#1): do the first thing\`
- Reviewer note: line one and
  line two.

### S2 — Mechanical docs

- Kind: mechanical
- Budget: 30 changed lines
- Tests: none.
- Commit: \`docs(#1): docs\`
- Reviewer note: none.

### Not a slice heading

- Kind: behavioral

## Coverage

- Not a slice.
`;

describe('parsePlanSlices', () => {
	it('parses plan entries with wrapped fields and verbatim entries', () => {
		const slices = parsePlanSlices(PLAN);
		expect(slices.map((slice) => slice.id)).toEqual(['S1', 'S2']);
		expect(slices[0]).toMatchObject({
			idea: 'Do the first thing',
			kind: 'behavioral',
			budget: 120,
			reviewerNote: 'line one and line two.',
		});
		expect(slices[0]?.files).toContain('wrapped continuation');
		expect(slices[0]?.entry).toContain('### S1 — Do the first thing');
		expect(slices[0]?.entry).toContain('  wrapped continuation.');
		expect(slices[0]?.entry.endsWith('line two.')).toBe(true);
	});

	it('does not parse headings outside or inside the slice list', () => {
		expect(parsePlanSlices('## Coverage\n\n### S1 — Nope\n')).toEqual([]);
		const slices = parsePlanSlices(PLAN);
		const ids = slices.map((slice) => slice.id);
		expect(ids).not.toContain('Not a slice heading');
		expect(ids).toHaveLength(2);
		expect(slices[1]?.kind).toBe('mechanical');
		expect(slices[1]?.entry).not.toContain('Not a slice heading');
	});
});

describe('decide', () => {
	it('reviews priority paths even when mechanical or tiny', () => {
		expect(decide({ kind: 'mechanical', total: 5, paths: ['src/lib/engine/x.ts'] })).toMatchObject({
			review: true,
		});
		expect(decide({ kind: 'behavioral', total: 5, paths: ['src/lib/schedules/x.ts'] }).review).toBe(
			true,
		);
	});

	it('skips mechanical slices before applying the size rule', () => {
		expect(decide({ kind: 'mechanical', total: 500, paths: ['README.md'] })).toEqual({
			review: false,
			reason: 'mechanical slice',
		});
	});

	it('uses the 60-line threshold', () => {
		expect(decide({ kind: 'behavioral', total: 59, paths: [] }).review).toBe(false);
		expect(decide({ kind: 'behavioral', total: 60, paths: [] }).review).toBe(true);
	});
});

describe('CLI guards', () => {
	const repoRoot = fileURLToPath(new URL('..', import.meta.url));
	const script = fileURLToPath(new URL('./slice-pack.mjs', import.meta.url));

	function run(args: string[], plan: string, out: string) {
		return spawnSync(process.execPath, [script, '--plan', plan, '--out', out, ...args], {
			cwd: repoRoot,
			encoding: 'utf8',
		});
	}

	function fixture() {
		const dir = mkdtempSync(join(tmpdir(), 'slice-pack-'));
		const plan = join(dir, 'plan.md');
		writeFileSync(plan, '## Slices\n');
		return { plan, out: join(dir, 'out') };
	}

	it('requires --base before reading the plan', () => {
		const { plan, out } = fixture();
		const result = run([], plan, out);
		expect(result.status).toBe(2);
		expect(result.stderr).toContain('--base');
		expect(existsSync(join(out, 'INDEX.md'))).toBe(false);
	});

	it('rejects an empty commit range without writing output', () => {
		const { plan, out } = fixture();
		const result = run(['--base', 'HEAD', '--head', 'HEAD'], plan, out);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain('no slice commits');
		expect(existsSync(join(out, 'INDEX.md'))).toBe(false);
	});
});
