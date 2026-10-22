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
