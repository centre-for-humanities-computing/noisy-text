// Generic smoke test: every visible registered strategy renders and scrubs
// without errors. `embedding-knn` needs remote embedding assets and is skipped
// until a fixture route exists (see the example at the bottom).
import { expect, test } from '@playwright/test';
import { STRATEGIES } from '../src/lib/strategies/registry';

const NEEDS_FIXTURE = new Set<string>(['embedding-knn']);
const TOKENIZER_TIMEOUT = 120_000;

const strategies = Object.entries(STRATEGIES).filter(
	([id, info]) => !info.hidden && !NEEDS_FIXTURE.has(id),
);

for (const [id] of strategies) {
	test(`strategy ${id} renders and scrubs`, async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));
		page.on('console', (m) => {
			if (m.type() === 'error') errors.push(m.text());
		});

		await page.goto('/');
		await page.getByTestId('input-text').fill('The quick brown fox jumps over the lazy dog.');

		const card = page.getByTestId(`strategy-${id}`);
		await expect(card).toBeEnabled({ timeout: TOKENIZER_TIMEOUT });
		await card.click();
		await expect(card).toHaveAttribute('aria-checked', 'true');

		await page.getByTestId('noise-button').click();

		const slider = page.getByTestId('time-slider');
		await expect(slider).toBeVisible();
		await expect(slider).toBeEnabled({ timeout: TOKENIZER_TIMEOUT });
		const max = Number((await slider.getAttribute('max')) ?? '1');
		const output = page.getByTestId('output');
		// Prose view: decoded text is non-empty while any real token survives.
		for (const frac of [0, 0.5]) {
			await slider.fill(String(Math.round(max * frac)));
			await expect(output).not.toBeEmpty();
		}

		// Terminal step. `absorbing` masks every token and the prose view
		// filters the mask sentinel out, so the prose view may legitimately be
		// empty at $t = T$; the Tokens view still renders one chip per token.
		await slider.fill(String(max));
		await page.getByRole('radio', { name: 'Tokens', exact: true }).click();
		await expect(output).not.toBeEmpty();
		await expect(page.locator('[title^="id: "]').first()).toBeVisible();
		if (id === 'absorbing') {
			await expect(output).toContainText('[MASK]');
		}

		expect(errors).toEqual([]);
	});
}

// Example fixture pattern for strategies that fetch assets:
// await page.route('**/embeddings/**', (route) =>
//   route.fulfill({ path: 'e2e/fixtures/tiny-bundle/' + new URL(route.request().url()).pathname.split('/').pop() }));
