import type { Tokenizer, TokenizerInfo } from './types.js';
import { parseWordVocab } from './word-vocab.js';
import { createWordTokenizer } from './word.js';
import { EMBEDDING_BASE_URL, fetchBytes } from '../embeddings/loader.js';
import { idbGet, idbPut, VOCAB_STORE } from '../embeddings/idb.js';

/**
 * Hosted word-vocabulary loader.
 *
 * The JSON file is produced by `scripts/export_word_vocab.py` and lives beside
 * the embedding bundles on the HF dataset. The parsed word list is cached in
 * IndexedDB under the vocabulary URL, so a reload skips the network. A cache
 * hit reports `{ loaded: 0, total: null, fraction: 1 }`.
 */

/** Hosted vocabulary file name. */
export const WORD_VOCAB_FILE = 'word-vocab-50k.json';

/** Progress for a vocabulary fetch. `total`/`fraction` are null when unknown. */
export interface WordVocabProgress {
	loaded: number;
	total: number | null;
	fraction: number | null;
}

/** Resolve the vocabulary URL from the configured base. */
function wordVocabUrl(): string {
	const configured = import.meta.env.VITE_WORD_VOCAB_BASE_URL as string | undefined;
	const base = (configured ?? EMBEDDING_BASE_URL).replace(/\/$/, '');
	return `${base}/${WORD_VOCAB_FILE}`;
}

/**
 * Load the hosted word vocabulary and wrap it in a word-level tokenizer.
 *
 * A URL-keyed IndexedDB hit skips the fetch. On a miss the file is streamed
 * with byte progress, validated by {@link parseWordVocab}, cached, and wrapped
 * by {@link createWordTokenizer}. Fetch/parse failures are prefixed with the
 * URL so the tokenizer store's error path identifies the asset.
 */
export async function loadWordTokenizer(
	info: TokenizerInfo,
	onProgress?: (progress: WordVocabProgress) => void,
): Promise<Tokenizer> {
	const url = wordVocabUrl();

	const cached = await idbGet<readonly string[]>(VOCAB_STORE, url);
	if (cached) {
		onProgress?.({ loaded: 0, total: null, fraction: 1 });
		return createWordTokenizer(info, cached);
	}

	try {
		let reported = false;
		const bytes = await fetchBytes(url, (loaded, total) => {
			reported = true;
			onProgress?.({ loaded, total, fraction: total > 0 ? loaded / total : null });
		});
		// A server without `content-length` never invokes the callback; report
		// one final event so callers can still clear their loading state.
		if (!reported) onProgress?.({ loaded: bytes.byteLength, total: null, fraction: null });

		const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
		const words = parseWordVocab(parsed);
		void idbPut(VOCAB_STORE, url, words);
		return createWordTokenizer(info, words);
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`Failed to load word vocabulary from ${url}: ${message}`, { cause: error });
	}
}
