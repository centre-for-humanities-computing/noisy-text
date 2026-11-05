import type { Page } from '@playwright/test';

export interface ProseSpan {
	text: string;
	start: number;
	end: number;
	tokenId: string;
}

/** Read the prose text and its per-token spans, preserving `\n`. */
export async function readProse(page: Page): Promise<{ text: string; spans: ProseSpan[] } | null> {
	return page.evaluate(() => {
		const prose = document.querySelector('[data-testid="prose-text"]');
		if (!prose) return null;
		const spans: ProseSpan[] = Array.from(
			prose.querySelectorAll('[data-testid="prose-token"]'),
		).map((el) => ({
			text: el.textContent ?? '',
			start: Number(el.getAttribute('data-start')),
			end: Number(el.getAttribute('data-end')),
			tokenId: el.getAttribute('data-token-id') ?? '',
		}));
		return { text: prose.textContent ?? '', spans };
	});
}
