import { describe, expect, it } from 'vitest';
import {
	decide,
	parsePlanSlices,
	planIdFor,
	priorityFor,
	renderIndex,
	renderPacket,
	renderSkipped,
} from './slice-pack.mjs';

const PLAN = `# Plan

Intro.

## Slices

### S1 — Do the first thing

- Kind: behavioral
- Budget: 120 changed lines
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
		const ids = parsePlanSlices(PLAN).map((slice) => slice.id);
		expect(ids).not.toContain('Not a slice heading');
		expect(ids).toHaveLength(2);
	});
});

describe('planIdFor', () => {
	it('maps split and suffixed slices to their plan entry', () => {
		expect(planIdFor('S1')).toBe('S1');
		expect(planIdFor('S1a')).toBe('S1');
		expect(planIdFor('S10b/8')).toBe('S10');
		expect(planIdFor('report')).toBeNull();
		expect(planIdFor('')).toBeNull();
	});
});

describe('priorityFor', () => {
	it('returns the priority paths and their labels', () => {
		expect(priorityFor(['src/lib/engine/trajectory.ts', 'README.md'])).toEqual([
			{ path: 'src/lib/engine/trajectory.ts', label: 'engine' },
		]);
		expect(priorityFor(['src/lib/stores/trajectory.svelte.ts'])).toEqual([
			{ path: 'src/lib/stores/trajectory.svelte.ts', label: 'stores' },
		]);
		expect(priorityFor(['src/lib/components/Panel.svelte'])).toEqual([]);
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

describe('renderIndex', () => {
	it('renders one line per entry with the decision and packet link', () => {
		const index = renderIndex([
			{
				slice: 'S1',
				short: 'abc1234',
				subject: 'feat: first',
				kind: 'behavioral',
				added: 10,
				removed: 5,
				total: 15,
				paths: [],
				decision: { review: true, reason: '15 lines' },
				packet: true,
			},
			{
				slice: 'S2',
				short: 'def5678',
				subject: 'docs: second',
				kind: 'mechanical',
				added: 1,
				removed: 1,
				total: 2,
				paths: [],
				decision: { review: false, reason: 'mechanical slice' },
			},
		]);
		expect(index).toContain('- Entries: 2 (review 1, skip 1)');
		expect(index).toContain(
			'- `S1` `abc1234` behavioral +10/-5 = 15 — feat: first — review: 15 lines → `S1.md`',
		);
		expect(index).toContain(
			'- `S2` `def5678` mechanical +1/-1 = 2 — docs: second — skip: mechanical slice',
		);
	});
});

describe('renderPacket', () => {
	it('embeds the plan entry, reviewer note, checks, and the fenced diff', () => {
		const plan = parsePlanSlices(PLAN)[0];
		const packet = renderPacket({
			slice: 'S1a',
			short: 'abc1234',
			subject: 'feat: first',
			kind: 'behavioral',
			added: 10,
			removed: 5,
			total: 15,
			paths: ['src/a.ts', 'src/a.test.ts'],
			decision: { review: true, reason: '15 lines' },
			plan,
			diff: 'diff --git a/src/a.ts b/src/a.ts\n+hello',
			context: 10,
			packet: true,
		});
		expect(packet).toContain('## Plan entry');
		expect(packet).toContain(plan.entry);
		expect(packet).toContain('line one and\n  line two.');
		expect(packet).toContain('Review focus: correctness; test adequacy');
		expect(packet).toContain('Tests in commit: src/a.test.ts');
		expect(packet).toContain('Kind matches plan: PASS');
		expect(packet).toContain('`````diff\n');
		expect(packet).toContain('+hello');
		expect(packet).toContain('## Diff (-U10)');
	});
});

describe('renderSkipped', () => {
	it('lists every skipped slice with its reason', () => {
		const skipped = renderSkipped([
			{
				slice: 'S2',
				short: 'def5678',
				subject: 'docs: second',
				kind: 'mechanical',
				added: 1,
				removed: 1,
				total: 2,
				paths: [],
				decision: { review: false, reason: 'mechanical slice' },
			},
			{
				slice: 'S3',
				short: 'fed9876',
				subject: 'docs: third',
				kind: 'mechanical',
				added: 2,
				removed: 0,
				total: 2,
				paths: [],
				decision: { review: false, reason: '2 lines < 60' },
			},
		]);
		expect(skipped).toContain(
			'`S2` `def5678` mechanical +1/-1 = 2 — docs: second — mechanical slice',
		);
		expect(skipped).toContain('`S3` `fed9876` mechanical +2/-0 = 2 — docs: third — 2 lines < 60');
	});
});
