// Prose view alignment for the uncased BERT tokenizer: every token highlight
// must cover exactly that token's characters in the decoded prose text.
// Expectations are hardcoded per tokenizer, including a multi-piece BERT word,
// so a dropped `##` continuation token fails the test. The post-scrub phase
// exercises the mask path: sentinels are dropped without shifting later spans.
import { expect, test } from '@playwright/test';

const TOKENIZER_TIMEOUT = 120_000;

interface Fixture {
	id: string;
	input: string;
	/** The exact decoded prose the app must render. */
	prose: string;
	/** Expected token text per span, in order. */
	tokens: string[];
	/** Expected `[start, end)` per span, in order. */
	spans: Array<[number, number]>;
}

const FIXTURES: Fixture[] = [
	{
		id: 'bert-base-uncased',
		input: 'hyphenated hyphen',
		prose: 'hyphenated hyphen',
		tokens: ['h', 'yp', 'hen', 'ated', 'h', 'yp', 'hen'],
		spans: [
			[0, 1],
			[1, 3],
			[3, 6],
			[6, 10],
			[11, 12],
			[12, 14],
			[14, 17],
		],
	},
	{
		// GPT-2 BPE carries each piece's leading space in its own decode,
		// so the whole-sequence decode is plain concatenation.
		id: 'gpt2',
		input: 'hello world',
		prose: 'hello world',
		tokens: ['hello', ' world'],
		spans: [
			[0, 5],
			[5, 11],
		],
	},
	{
		// GPT-2 BPE decodes `##` literally: round 2 stripped a leading `##`
		// unconditionally, which dropped this token entirely.
		id: 'gpt2',
		input: '## heading',
		prose: '## heading',
		tokens: ['##', ' heading'],
		spans: [
			[0, 2],
			[2, 10],
		],
	},
];

interface SpanInfo {
	text: string;
	start: number;
	end: number;
	tokenId: string;
}

async function readProse(page: import('@playwright/test').Page) {
	return page.evaluate(() => {
		const prose = document.querySelector('[data-testid="prose-text"]');
		if (!prose) return null;
		const spans: SpanInfo[] = Array.from(prose.querySelectorAll('[data-testid="prose-token"]')).map(
			(el) => ({
				text: el.textContent ?? '',
				start: Number(el.getAttribute('data-start')),
				end: Number(el.getAttribute('data-end')),
				tokenId: el.getAttribute('data-token-id') ?? '',
			}),
		);
		return { text: prose.textContent ?? '', spans };
	});
}

async function selectCard(page: import('@playwright/test').Page, testid: string) {
	const card = page.getByTestId(testid);
	await expect(card).toBeEnabled({ timeout: TOKENIZER_TIMEOUT });
	await card.click();
	await expect(card).toHaveAttribute('aria-checked', 'true');
}

/** Wait for the trajectory recompute to finish. */
async function waitForReady(page: import('@playwright/test').Page) {
	const status = page.getByTestId('app-status');
	await expect(status).toHaveAttribute('data-trajectory-status', 'ready', {
		timeout: TOKENIZER_TIMEOUT,
	});
}

for (const fixture of FIXTURES) {
	const id = fixture.id;

	test(`prose spans match the decoded text for ${id} (${fixture.input})`, async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));
		page.on('console', (m) => {
			if (m.type() === 'error') errors.push(m.text());
		});

		await page.goto('/');
		// Wait for the app to be hydrated and the tokenizer loaded before
		// filling the textarea, or the fill is overwritten by the default.
		await selectCard(page, `tokenizer-${id}`);
		await page.getByTestId('input-text').fill(fixture.input);
		await page.getByTestId('noise-button').click();
		await waitForReady(page);

		// Unmasked trajectory: exact hardcoded spans and token strings.
		const result = await readProse(page);
		expect(result).not.toBeNull();
		const { text, spans } = result!;
		expect(text).toBe(fixture.prose);
		expect(spans).toHaveLength(fixture.tokens.length);
		expect(spans.map((s) => [s.start, s.end])).toEqual(fixture.spans);
		for (let i = 0; i < spans.length; i++) {
			const s = spans[i]!;
			// The slice must equal the expected token string — not the span's
			// own textContent, which could agree with a wrong span.
			expect(text.slice(s.start, s.end)).toBe(fixture.tokens[i]!);
			if (i > 0) {
				expect(s.start).toBeGreaterThanOrEqual(spans[i - 1]!.end);
			}
		}
		// No misalignment accumulates: the final span ends at the prose end.
		expect(spans[spans.length - 1]!.end).toBe(text.length);

		// Record tokenId → token text before masking.
		const tokenTextById = new Map<string, string>();
		for (const s of spans) tokenTextById.set(s.tokenId, text.slice(s.start, s.end));

		// Mask path: absorb noise, scrub forward in 5% steps. Under the
		// default linear schedule and seed 42, 10% leaves every token
		// unmasked, so the loop advances until the first partial state.
		// Selecting a new strategy triggers a recompute on its own; in
		// explore mode there is no noise button.
		await selectCard(page, 'strategy-absorbing');
		await waitForReady(page);

		const slider = page.getByTestId('time-slider');
		const max = Number((await slider.getAttribute('max')) ?? '1');

		// Scrub forward gradually until the noise has actually taken effect:
		// low t under the absorbing strategy may not have masked anything yet.
		let noised: Awaited<ReturnType<typeof readProse>> = null;
		for (let frac = 0.05; frac <= 1.001; frac += 0.05) {
			await slider.fill(String(Math.round(max * frac)));
			const current = await readProse(page);
			if (current && current.text !== fixture.input && current.spans.length >= 1) {
				noised = current;
				break;
			}
		}
		expect(noised, 'no timestep produced a partly-masked prose').not.toBeNull();
		const { text: noisedText, spans: noisedSpans } = noised!;
		// The trajectory actually noised the text.
		expect(noisedText).not.toBe(fixture.input);
		expect(noisedSpans.length).toBeGreaterThanOrEqual(1);
		for (let i = 0; i < noisedSpans.length; i++) {
			const s = noisedSpans[i]!;
			if (i > 0) {
				expect(s.start).toBeGreaterThanOrEqual(noisedSpans[i - 1]!.end);
			}
			// Every surviving span still renders its own token's text. For
			// WordPiece, a continuation whose predecessor got masked is now
			// the first visible piece, and the whole-sequence decode keeps
			// `##` on the first token — so it legitimately gains the prefix.
			const expected = tokenTextById.get(s.tokenId);
			expect(expected).toBeDefined();
			const rendered = noisedText.slice(s.start, s.end);
			expect(rendered === expected! || rendered === `##${expected}`).toBe(true);
		}

		expect(errors).toEqual([]);
	});
}
