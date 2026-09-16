import { describe, it, expect } from 'vitest';
import katex from 'katex';

describe('InfoTooltip maths rendering', () => {
	it('renders inline KaTeX from a TeX string', () => {
		const html = katex.renderToString('x^2 + y^2 = 1', {
			throwOnError: false,
			displayMode: false,
		});
		expect(html).toContain('katex');
		expect(html).toContain('x');
	});

	it('renders Greek letters and subscripts', () => {
		const html = katex.renderToString('\\beta_t = \\beta_{\\min} + \\Delta \\cdot t', {
			throwOnError: false,
			displayMode: false,
		});
		expect(html).toContain('katex');
	});

	it('renders fractions', () => {
		const html = katex.renderToString('\\frac{\\beta_t}{K}', {
			throwOnError: false,
			displayMode: false,
		});
		expect(html).toContain('frac');
	});

	it('renders matrices', () => {
		const html = katex.renderToString('Q_t = (1-\\beta_t)I + \\beta_t R', {
			throwOnError: false,
			displayMode: false,
		});
		expect(html).toContain('katex');
	});

	it('does not throw on invalid TeX with throwOnError: false', () => {
		const html = katex.renderToString('\\invalid{', {
			throwOnError: false,
			displayMode: false,
		});
		// Should return something (the raw text or an error span), not throw
		expect(typeof html).toBe('string');
		expect(html.length).toBeGreaterThan(0);
	});
});

describe('registry tooltip fields', () => {
	it('every strategy has plainName, gloss, and tooltip', async () => {
		const { STRATEGIES } = await import('$lib/strategies/index.js');
		for (const [, info] of Object.entries(STRATEGIES)) {
			expect(typeof info.plainName).toBe('string');
			expect(info.plainName.length).toBeGreaterThan(0);
			expect(typeof info.gloss).toBe('string');
			expect(info.gloss.length).toBeGreaterThan(0);
			expect(typeof info.tooltip).toBe('object');
			expect(typeof info.tooltip.text).toBe('string');
			expect(info.tooltip.text.length).toBeGreaterThan(0);
		}
	});

	it('every schedule has plainName, gloss, and tooltip', async () => {
		const { SCHEDULES } = await import('$lib/schedules/index.js');
		for (const [, info] of Object.entries(SCHEDULES)) {
			expect(typeof info.plainName).toBe('string');
			expect(info.plainName.length).toBeGreaterThan(0);
			expect(typeof info.gloss).toBe('string');
			expect(info.gloss.length).toBeGreaterThan(0);
			expect(typeof info.tooltip).toBe('object');
			expect(typeof info.tooltip.text).toBe('string');
			expect(info.tooltip.text.length).toBeGreaterThan(0);
		}
	});

	it('every tokenizer has plainName, gloss, and tooltip', async () => {
		const { TOKENIZERS } = await import('$lib/tokenizers/index.js');
		for (const [, info] of Object.entries(TOKENIZERS)) {
			expect(typeof info.plainName).toBe('string');
			expect(info.plainName.length).toBeGreaterThan(0);
			expect(typeof info.gloss).toBe('string');
			expect(info.gloss.length).toBeGreaterThan(0);
			expect(typeof info.tooltip).toBe('object');
			expect(typeof info.tooltip.text).toBe('string');
			expect(info.tooltip.text.length).toBeGreaterThan(0);
		}
	});

	it('strategy tooltip math strings render with KaTeX', async () => {
		const { STRATEGIES } = await import('$lib/strategies/index.js');
		for (const [, info] of Object.entries(STRATEGIES)) {
			if (info.tooltip.math) {
				const html = katex.renderToString(info.tooltip.math, {
					throwOnError: false,
					displayMode: false,
				});
				expect(html).toContain('katex');
			}
		}
	});

	it('schedule tooltip math strings render with KaTeX', async () => {
		const { SCHEDULES } = await import('$lib/schedules/index.js');
		for (const [, info] of Object.entries(SCHEDULES)) {
			if (info.tooltip.math) {
				const html = katex.renderToString(info.tooltip.math, {
					throwOnError: false,
					displayMode: false,
				});
				expect(html).toContain('katex');
			}
		}
	});
});
