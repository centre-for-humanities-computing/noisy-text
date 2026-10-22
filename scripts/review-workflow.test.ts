import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const agent = (name: string): string =>
	readFileSync(new URL(`../.opencode/agent/${name}.md`, import.meta.url), 'utf8');

describe('slice-reviewer', () => {
	const text = agent('slice-reviewer');

	it('uses native V2 permissions with a deny-all rule first', () => {
		expect(text).toContain('permissions:');
		expect(text).not.toMatch(/\npermission:/);
		expect(text).toContain("- action: '*'\n    resource: '*'\n    effect: deny");
		expect(text).toContain('steps: 3');
		expect(text).not.toMatch(/action: shell/);
	});

	it('treats the packet as the only input', () => {
		expect(text).toContain('The packet is complete. Do not read files, run commands, or explore.');
		expect(text).toContain('At most 3 findings');
		expect(text).toContain('Do not attempt to reproduce findings');
		expect(text).not.toContain('"repro"');
		expect(text).not.toMatch(/git show/);
		expect(text).not.toMatch(/Run the (tests|command)/);
		expect(text).not.toMatch(/Read the (repo|file)/);
	});
});

describe('reviewer', () => {
	const text = agent('reviewer');

	it('verifies blockers and high-confidence findings only', () => {
		expect(text).toContain('high-confidence');
		expect(text).toContain('Reproduce only the blockers');
		expect(text).toContain('_skipped.md');
		expect(text).toContain('INDEX.md');
		expect(text).not.toContain('verify each candidate finding');
	});
});

describe('review command', () => {
	const text = readFileSync(new URL('../.opencode/command/review.md', import.meta.url), 'utf8');

	it('builds packets and delivers them inline', () => {
		expect(text).toContain('scripts/slice-pack.mjs');
		expect(text).toContain('_skipped.md');
		expect(text).toContain('pass its content inline');
		expect(text).toContain('Do not pass a path for the reviewer to open');
		expect(text).not.toContain('Skip `Kind: mechanical` slices unless');
		const packet = text.lastIndexOf('PACKET');
		const content = text.lastIndexOf('<packet content>');
		const output = text.lastIndexOf('OUTPUT');
		expect(packet).toBeGreaterThan(-1);
		expect(content).toBeGreaterThan(packet);
		expect(output).toBeGreaterThan(content);
	});
});
