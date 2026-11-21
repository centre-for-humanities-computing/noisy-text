import { expect, type Page } from '@playwright/test';

/**
 * Unlock the tokenizer picker before selecting a tokenizer. `embedding-knn`
 * and `wordnet` pin the tokenizer, so choose a strategy that does not before
 * switching tokenizers.
 */
export async function unlockTokenizer(page: Page, timeout = 120_000): Promise<void> {
	const uniform = page.getByTestId('strategy-uniform');
	await expect(uniform).toBeEnabled({ timeout });
	await uniform.click();
	await expect(uniform).toHaveAttribute('aria-checked', 'true');
}
