// Prose view alignment for the uncased BERT tokenizer: every token highlight
// must cover exactly that token's characters in the decoded prose text.
// Covers the WordPiece separator case (`bert-base-uncased`) and the
// leading-space case (`gpt2`).
import { expect, test } from '@playwright/test';

const TOKENIZER_TIMEOUT = 120_000;
const INPUT = 'The quick brown fox jumps over the lazy dog again and again';
const TOKENIZERS = ['bert-base-uncased', 'gpt2'];

interface SpanInfo {
	text: string;
	start: number;
	end: number;
}

async function assertAlignment(page: import('@playwright/test').Page) {
	const result = await page.evaluate(() => {
		const prose = document.querySelector('[data-testid="prose-text"]');
		if (!prose) return null;
		const text = prose.textContent ?? '';
		const spans: SpanInfo[] = Array.from(prose.querySelectorAll('[data-testid="prose-token"]')).map(
			(el) => ({
				text: el.textContent ?? '',
				start: Number(el.getAttribute('data-start')),
				end: Number(el.getAttribute('data-end')),
			}),
		);
		return { text, spans };
	});

	expect(result).not.toBeNull();
	const { text, spans } = result!;
	expect(spans.length).toBeGreaterThanOrEqual(4);

	for (let i = 0; i < spans.length; i++) {
		const span = spans[i]!;
		// Spans are sorted by start and non-overlapping.
		if (i > 0) {
			expect(span.start).toBeGreaterThanOrEqual(spans[i - 1]!.end);
		}
		// The highlight covers exactly the token's own characters.
		expect(text.slice(span.start, span.end)).toBe(span.text);
	}

	// The final span ends at the end of the decoded prose.
	expect(spans[spans.length - 1]!.end).toBe(text.length);
}

for (const id of TOKENIZERS) {
	test(`prose alignment holds for ${id}`, async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));

		await page.goto('/');
		await page.getByTestId('input-text').fill(INPUT);

		const card = page.getByTestId(`tokenizer-${id}`);
		await expect(card).toBeEnabled({ timeout: TOKENIZER_TIMEOUT });
		await card.click();
		await expect(card).toHaveAttribute('aria-checked', 'true');

		await page.getByTestId('noise-button').click();

		const slider = page.getByTestId('time-slider');
		await expect(slider).toBeEnabled({ timeout: TOKENIZER_TIMEOUT });

		await assertAlignment(page);

		// Scrub to the middle: mask tokens are dropped without shifting
		// later spans, so the invariant must still hold.
		const max = Number((await slider.getAttribute('max')) ?? '1');
		await slider.fill(String(max / 2));
		await assertAlignment(page);

		expect(errors).toEqual([]);
	});
}
