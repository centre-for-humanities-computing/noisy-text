import { loadTokenizer, type Tokenizer } from '$lib/tokenizers/index.js';

export type TokenizerStatus = 'idle' | 'loading' | 'ready' | 'error';

class TokenizerStore {
	currentId: string = $state('gpt2');
	tokenizer: Tokenizer | null = $state(null);
	status: TokenizerStatus = $state('idle');
	error: string | null = $state(null);

	async selectTokenizer(id: string): Promise<void> {
		if (this.status === 'loading') return;
		this.currentId = id;
		this.status = 'loading';
		this.error = null;
		try {
			this.tokenizer = await loadTokenizer(id);
			this.status = 'ready';
		} catch (e: unknown) {
			this.status = 'error';
			this.error = e instanceof Error ? e.message : String(e);
		}
	}
}

/** Singleton tokenizer store. */
export const tokenizerStore = new TokenizerStore();
