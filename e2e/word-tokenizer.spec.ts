// End-to-end coverage for the hosted word tokenizer and its OOV ids.
import { expect, test, type Page } from '@playwright/test';

const FIXTURE = 'e2e/fixtures/word-vocab/word-vocab-50k.json';
const TIMEOUT = 120_000;

/** Route the hosted vocabulary to the local fixture and count fulfills. */
async function routeVocab(page: Page, counter: { n: number }): Promise<void> {
	await page.route('**/word-vocab-50k.json', async (route) => {
		counter.n++;
		await route.fulfill({ path: FIXTURE, contentType: 'application/json' });
	});
}

/** Wait for a tokenizer card to be clickable, then select it. */
async function selectTokenizer(page: Page, id: string): Promise<void> {
	const card = page.getByTestId(`tokenizer-${id}`);
	await expect(card).toBeEnabled({ timeout: TIMEOUT });
	await card.click();
	await expect(card).toHaveAttribute('aria-checked', 'true');
}

/** Wait for the explore view to show the word tokenizer and a ready trajectory. */
async function waitReady(page: Page): Promise<void> {
	const status = page.getByTestId('app-status');
	await expect(status).toContainText('Word vocabulary', { timeout: TIMEOUT });
	await expect(status).toHaveAttribute('data-trajectory-status', 'ready', { timeout: TIMEOUT });
}

test('word tokenizer renders prose and OOV ids', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(m.text());
	});
	const counter = { n: 0 };
	await routeVocab(page, counter);

	await page.goto('/');
	await expect(page.getByTestId('noise-button')).toBeEnabled({ timeout: TIMEOUT });
	// Fill before selecting `words`: the default passage would otherwise fill the
	// append-only OOV table first and shift the expected ids.
	await page.getByTestId('input-text').fill('the quick zorblax jumps');
	await selectTokenizer(page, 'words');
	await expect(page.getByTestId('noise-button')).toBeEnabled({ timeout: TIMEOUT });
	await page.getByTestId('noise-button').click();

	await waitReady(page);
	await expect(page.getByTestId('app-status')).toContainText('(+2 OOV)', { timeout: TIMEOUT });

	const slider = page.getByTestId('time-slider');
	await expect(slider).toBeEnabled({ timeout: TIMEOUT });
	await slider.fill('0');

	await expect(page.getByTestId('prose-text')).toHaveText('the quick zorblax jumps', {
		timeout: TIMEOUT,
	});
	const zorblax = page.locator('[data-testid="prose-token"][aria-label="token zorblax"]');
	await expect(zorblax).toHaveAttribute('data-token-id', '41', { timeout: TIMEOUT });
	await zorblax.hover();
	await expect(page.locator('[role="tooltip"] svg')).toContainText('zorblax', { timeout: TIMEOUT });

	await page.getByRole('radio', { name: 'Tokens', exact: true }).click();
	await expect(page.locator('[title="id: 41"]').filter({ hasText: 'zorblax' })).toBeVisible({
		timeout: TIMEOUT,
	});

	expect(errors).toEqual([]);
});

test('absorbing masks use the growing OOV sentinel', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(m.text());
	});
	const counter = { n: 0 };
	await routeVocab(page, counter);

	await page.goto('/');
	await expect(page.getByTestId('noise-button')).toBeEnabled({ timeout: TIMEOUT });
	await page.getByTestId('input-text').fill('the quick zorblax jumps');
	await selectTokenizer(page, 'words');
	await expect(page.getByTestId('noise-button')).toBeEnabled({ timeout: TIMEOUT });
	const absorbing = page.getByTestId('strategy-absorbing');
	await expect(absorbing).toBeEnabled({ timeout: TIMEOUT });
	await absorbing.click();
	await expect(absorbing).toHaveAttribute('aria-checked', 'true');
	await page.getByTestId('noise-button').click();

	await waitReady(page);
	await expect(page.getByTestId('app-status')).toContainText('(+2 OOV)', { timeout: TIMEOUT });

	const slider = page.getByTestId('time-slider');
	await expect(slider).toBeEnabled({ timeout: TIMEOUT });
	const max = Number((await slider.getAttribute('max')) ?? '1');
	await slider.fill(String(max));

	await page.getByRole('radio', { name: 'Tokens', exact: true }).click();
	await expect(page.getByTestId('output')).toContainText('[MASK]', { timeout: TIMEOUT });
	await expect(page.locator('[title="id: 42"]').first()).toBeVisible({ timeout: TIMEOUT });

	await page.getByRole('button', { name: 'Edit' }).click();
	await page.getByTestId('input-text').fill('the zorblax quux');
	await page.getByTestId('noise-button').click();

	await expect(page.getByTestId('app-status')).toContainText('(+3 OOV)', { timeout: TIMEOUT });
	await expect(page.getByTestId('app-status')).toHaveAttribute('data-trajectory-status', 'ready', {
		timeout: TIMEOUT,
	});
	await expect(page.getByTestId('time-slider')).toBeEnabled({ timeout: TIMEOUT });
	await page.getByTestId('time-slider').fill(String(max));
	await expect(page.getByTestId('output')).toContainText('[MASK]', { timeout: TIMEOUT });
	await expect(page.locator('[title="id: 43"]').first()).toBeVisible({ timeout: TIMEOUT });

	expect(errors).toEqual([]);
});

test('word vocabulary is cached in IndexedDB across reloads', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(m.text());
	});
	const counter = { n: 0 };
	await routeVocab(page, counter);

	await page.goto('/');
	await expect(page.getByTestId('noise-button')).toBeEnabled({ timeout: TIMEOUT });
	await selectTokenizer(page, 'words');
	await expect(page.getByTestId('noise-button')).toBeEnabled({ timeout: TIMEOUT });
	await page.getByTestId('noise-button').click();
	await waitReady(page);
	const before = counter.n;
	expect(before).toBeGreaterThan(0);

	await page.reload();
	await expect(page.getByTestId('noise-button')).toBeEnabled({ timeout: TIMEOUT });
	await selectTokenizer(page, 'words');
	await expect(page.getByTestId('noise-button')).toBeEnabled({ timeout: TIMEOUT });
	expect(counter.n).toBe(before);

	expect(errors).toEqual([]);
});
