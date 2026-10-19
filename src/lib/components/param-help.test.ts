import { describe, it, expect } from 'vitest';
import katex from 'katex';
import * as paramHelp from './param-help.js';
import type { ParamHelp } from './param-help.js';

const COPY: Array<[string, ParamHelp]> = Object.entries(paramHelp);

describe('param-help copy', () => {
	it.each(COPY)('%s has non-empty text', (_name, copy) => {
		expect(typeof copy.text).toBe('string');
		expect(copy.text.length).toBeGreaterThan(0);
	});

	it.each(COPY)('%s math renders with KaTeX without a parse error', (_name, copy) => {
		if (!copy.math) return;
		const html = katex.renderToString(copy.math, { throwOnError: false, displayMode: false });
		expect(html).toContain('katex');
		// A parse error with throwOnError: false emits a katex-error span.
		expect(html).not.toContain('katex-error');
	});
});
