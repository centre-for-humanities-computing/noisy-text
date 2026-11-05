// End-to-end coverage for the hosted word tokenizer and its OOV ids.
import { expect, test, type Page } from '@playwright/test';
import { readProse } from './prose';

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

for (const strategy of ['lexical', 'char-overlap'] as const) {
	test(`word tokenizer: ${strategy} reaches ready over OOV whitespace`, async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));
		page.on('console', (m) => {
			if (m.type() === 'error') errors.push(m.text());
		});
		const counter = { n: 0 };
		await routeVocab(page, counter);

		await page.goto('/');
		await expect(page.getByTestId('noise-button')).toBeEnabled({ timeout: TIMEOUT });
		// Spaces and punctuation receive OOV ids alongside the unknown word.
		await page.getByTestId('input-text').fill('the quick, zorblax!');
		await selectTokenizer(page, 'words');
		await expect(page.getByTestId('noise-button')).toBeEnabled({ timeout: TIMEOUT });
		const card = page.getByTestId(`strategy-${strategy}`);
		await expect(card).toBeEnabled({ timeout: TIMEOUT });
		await card.click();
		await expect(card).toHaveAttribute('aria-checked', 'true');
		await page.getByTestId('noise-button').click();

		await waitReady(page);
		await expect(page.getByTestId('app-status')).toContainText('OOV', { timeout: TIMEOUT });
		await expect(page.getByTestId('time-slider')).toBeEnabled({ timeout: TIMEOUT });

		expect(errors).toEqual([]);
	});
}

for (const strategy of ['uniform', 'absorbing'] as const) {
	test(`word tokenizer: ${strategy} keeps whitespace in place`, async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));
		page.on('console', (m) => {
			if (m.type() === 'error') errors.push(m.text());
		});
		const counter = { n: 0 };
		await routeVocab(page, counter);

		await page.goto('/');
		await expect(page.getByTestId('noise-button')).toBeEnabled({ timeout: TIMEOUT });
		await page.getByTestId('input-text').fill('the quick\nbrown fox');
		await selectTokenizer(page, 'words');
		await expect(page.getByTestId('noise-button')).toBeEnabled({ timeout: TIMEOUT });
		const card = page.getByTestId(`strategy-${strategy}`);
		await expect(card).toBeEnabled({ timeout: TIMEOUT });
		await card.click();
		await expect(card).toHaveAttribute('aria-checked', 'true');
		await page.getByTestId('noise-button').click();

		await waitReady(page);
		const slider = page.getByTestId('time-slider');
		await slider.fill('0');
		const initial = (await readProse(page))!;
		const frozen = initial.spans.flatMap((s, i) => (s.text === ' ' || s.text === '\n' ? [i] : []));
		expect(frozen).toHaveLength(3);

		const max = Number((await slider.getAttribute('max')) ?? '1');
		await slider.fill(String(max));
		const final = (await readProse(page))!;
		const word = /\p{L}/u;
		const before = initial.spans.filter((s) => word.test(s.text)).length;
		const after = final.spans.filter((s) => word.test(s.text)).length;
		expect(after).toBeLessThanOrEqual(before);

		// Masked prose cells are omitted, so read every cell from the chips.
		await page.getByRole('radio', { name: 'Tokens', exact: true }).click();
		const chips = page.getByTestId('output').locator('.chip');
		await expect(chips).toHaveCount(initial.spans.length);
		for (const i of frozen) {
			await expect(chips.nth(i).locator('.chip-id')).toHaveText(initial.spans[i]!.tokenId);
			const visible = initial.spans[i]!.text === ' ' ? '␣' : '↵';
			await expect(chips.nth(i).locator('.chip-token')).toHaveText(visible);
		}

		expect(errors).toEqual([]);
	});
}

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

	// `zorblax` was already added to the instance's append-only OOV table and
	// `quux` extends it, so the status reports the whole table ("seen"): `+3`,
	// not a count of this input's new entries.
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

test('word prose spans, chips and mask scrubbing', async ({ page }) => {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(m.text());
	});
	const counter = { n: 0 };
	await routeVocab(page, counter);

	const INPUT = 'Don’t a,b\nzorblax!';
	// `a,b` gains a space after the comma; `\n` and the curly apostrophe do not.
	const PROSE = 'Don’t a, b\nzorblax!';
	const TOKENS = ['Don’t', ' ', 'a', ',', 'b', '\n', 'zorblax', '!'];
	const SPANS: Array<[number, number]> = [
		[0, 5],
		[5, 6],
		[6, 7],
		[7, 8],
		[9, 10],
		[10, 11],
		[11, 18],
		[18, 19],
	];

	await page.goto('/');
	await expect(page.getByTestId('noise-button')).toBeEnabled({ timeout: TIMEOUT });
	// Fill before selecting `words`, as above: the default passage would
	// otherwise allocate the first OOV ids.
	await page.getByTestId('input-text').fill(INPUT);
	await selectTokenizer(page, 'words');
	await expect(page.getByTestId('noise-button')).toBeEnabled({ timeout: TIMEOUT });
	await page.getByTestId('noise-button').click();
	await waitReady(page);
	await expect(page.getByTestId('app-status')).toContainText('Vocab: 40 (+7 OOV)', {
		timeout: TIMEOUT,
	});

	const initial = (await readProse(page))!;
	expect(initial.text).toBe(PROSE);
	expect(initial.spans.map((s) => s.text)).toEqual(TOKENS);
	expect(initial.spans.map((s) => [s.start, s.end])).toEqual(SPANS);

	// The OOV id resolves to its word in the prose tooltip.
	const zorblax = page.locator('[data-testid="prose-token"][aria-label="token zorblax"]');
	await expect(zorblax).toHaveAttribute('data-token-id', '45', { timeout: TIMEOUT });
	await zorblax.hover();
	await expect(page.locator('[role="tooltip"] svg')).toContainText('zorblax', { timeout: TIMEOUT });

	// Chips: `,` and `↵` read as themselves; `Don’t` keeps its case.
	await page.getByRole('radio', { name: 'Tokens', exact: true }).click();
	const output = page.getByTestId('output');
	await expect(output.locator('[aria-label="token ,"]')).toBeVisible({ timeout: TIMEOUT });
	await expect(output.locator('[aria-label="token ↵"]')).toBeVisible({ timeout: TIMEOUT });
	await expect(output.locator('[aria-label="token Don’t"]')).toContainText('Don’t', {
		timeout: TIMEOUT,
	});

	// Mask path: scrub into a partial mask, then back to $t = 0$.
	await page.getByRole('radio', { name: 'Prose', exact: true }).click();
	const absorbing = page.getByTestId('strategy-absorbing');
	await expect(absorbing).toBeEnabled({ timeout: TIMEOUT });
	await absorbing.click();
	await expect(absorbing).toHaveAttribute('aria-checked', 'true');
	await waitReady(page);

	const slider = page.getByTestId('time-slider');
	const max = Number((await slider.getAttribute('max')) ?? '1');
	const textById = new Map(initial.spans.map((s) => [s.tokenId, s.text]));
	let sawPartial = false;
	for (let frac = 0.05; frac <= 1.001; frac += 0.05) {
		await slider.fill(String(Math.round(max * frac)));
		const current = (await readProse(page))!;
		if (current.text === PROSE || current.text.length === 0) continue;
		sawPartial = true;
		for (const s of current.spans) {
			expect(textById.get(s.tokenId)).toBe(current.text.slice(s.start, s.end));
		}
		break;
	}
	expect(sawPartial, 'no step produced a partly-masked prose').toBe(true);

	await slider.fill('0');
	const roundTrip = (await readProse(page))!;
	expect(roundTrip.text).toBe(PROSE);
	expect(roundTrip.spans.map((s) => [s.start, s.end])).toEqual(SPANS);

	expect(errors).toEqual([]);
});
