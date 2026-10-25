// End-to-end coverage for embedding-kNN noise over the hosted word vocabulary.
import { expect, test } from '@playwright/test';
import { installTinyGloveBundle } from './fixtures/tiny-bundle';

const TIMEOUT = 120_000;
const INPUT = 'the quick brown zorblax';
/** Static ids 0…39 plus two per-instance OOV ids (the space and `zorblax`). */
const EFFECTIVE_VOCAB = 42;

test('embedding-knn keeps the word tokenizer and never reads OOV rows', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(m.text());
	});
	const { words } = await installTinyGloveBundle(page);
	expect(words).toHaveLength(40);

	await page.goto('/');
	await expect(page.getByTestId('noise-button')).toBeEnabled({ timeout: TIMEOUT });
	await page.getByTestId('input-text').fill(INPUT);
	await page.getByTestId('tokenizer-words').click();
	await expect(page.getByTestId('tokenizer-words')).toHaveAttribute('aria-checked', 'true');

	const strategy = page.getByTestId('strategy-embedding-knn');
	await expect(strategy).toBeEnabled({ timeout: TIMEOUT });
	await strategy.click();
	await expect(strategy).toHaveAttribute('aria-checked', 'true');

	// AC1: the word tokenizer stays selected and the only compatible source
	// (GloVe, vocab-aligned) replaces the default GPT-2 source.
	await expect(page.getByTestId('tokenizer-words')).toHaveAttribute('aria-checked', 'true');
	const glove = page.getByTestId('embedding-source-glove-840b-300d');
	await expect(glove).toHaveAttribute('aria-checked', 'true', { timeout: TIMEOUT });
	await expect(page.getByTestId('embedding-source-gpt2')).not.toHaveAttribute(
		'aria-checked',
		'true',
	);

	await expect(page.getByTestId('noise-button')).toBeEnabled({ timeout: TIMEOUT });
	await page.getByTestId('noise-button').click();

	const status = page.getByTestId('app-status');
	await expect(status).toContainText('Word vocabulary', { timeout: TIMEOUT });
	await expect(status).toHaveAttribute('data-trajectory-status', 'ready', { timeout: TIMEOUT });
	// One shared OOV id for the inter-word spaces and one for `zorblax`.
	await expect(status).toContainText('(+2 OOV seen)', { timeout: TIMEOUT });

	const slider = page.getByTestId('time-slider');
	await expect(slider).toBeEnabled({ timeout: TIMEOUT });
	await slider.fill('0');
	await expect(page.getByTestId('prose-text')).toHaveText(INPUT, { timeout: TIMEOUT });

	// AC3: at maximum noise, every rendered id is either a static row
	// ($0 \ldots K-1$) or a per-instance OOV id ($K \ldots K_{\text{eff}}-1$),
	// and no cell leaks a NaN/undefined from an out-of-range lookup.
	const max = Number((await slider.getAttribute('max')) ?? '1');
	await slider.fill(String(max));
	await page.getByRole('radio', { name: 'Tokens', exact: true }).click();
	const chips = page.getByTestId('output').locator('[title^="id: "]');
	await expect(chips.first()).toBeVisible({ timeout: TIMEOUT });
	const rendered = await chips.evaluateAll((els) =>
		els.map((el) => ({ title: el.getAttribute('title') ?? '', text: el.textContent ?? '' })),
	);
	expect(rendered).toHaveLength(7);
	for (const chip of rendered) {
		const match = /^id: (\d+)$/u.exec(chip.title);
		expect(match).not.toBeNull();
		const id = Number(match![1]);
		expect(id).toBeGreaterThanOrEqual(0);
		expect(id).toBeLessThan(EFFECTIVE_VOCAB);
		expect(chip.text).not.toMatch(/NaN|undefined/u);
	}

	expect(errors).toEqual([]);
});
