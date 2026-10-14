import { describe, it, expect } from 'vitest';
import katex from 'katex';
import { KERNEL_CAPTION, KERNEL_TOOLTIP, TAU_TOOLTIP, FAMILY_TOOLTIP } from './kernel-help.js';
import type { HelpCopy } from './kernel-help.js';

const COPY: Array<[string, HelpCopy]> = [
	['KERNEL_TOOLTIP', KERNEL_TOOLTIP],
	['TAU_TOOLTIP', TAU_TOOLTIP],
	['FAMILY_TOOLTIP', FAMILY_TOOLTIP],
];

describe('kernel-help copy', () => {
	it('caption is a non-empty string', () => {
		expect(typeof KERNEL_CAPTION).toBe('string');
		expect(KERNEL_CAPTION.length).toBeGreaterThan(0);
	});

	it.each(COPY)('%s has non-empty text and math', (_name, copy) => {
		expect(typeof copy.text).toBe('string');
		expect(copy.text.length).toBeGreaterThan(0);
		expect(typeof copy.math).toBe('string');
		expect(copy.math.length).toBeGreaterThan(0);
	});

	it.each(COPY)('%s math renders with KaTeX without a parse error', (_name, copy) => {
		const html = katex.renderToString(copy.math, { throwOnError: false, displayMode: false });
		expect(html).toContain('katex');
		// A parse error with throwOnError: false emits a katex-error span.
		expect(html).not.toContain('katex-error');
	});
});
