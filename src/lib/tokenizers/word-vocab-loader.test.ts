import { afterEach, describe, expect, it, vi } from 'vitest';

import { WORD_VOCAB_FILE, loadWordTokenizer } from './word-vocab-loader.js';
import type { TokenizerInfo } from './types.js';

const INFO: TokenizerInfo = {
	id: 'words',
	label: 'Word vocabulary (50k)',
	description: 'Test fixture',
	plainName: 'Whole words',
	gloss: 'Test gloss',
	wordPiece: false,
	tooltip: { text: 'Test tooltip' },
};

const BASE = 'https://example.test/vocab/';

/** Build a valid vocabulary JSON body with `words` ordered by ascending rank. */
function body(words: string[] = ['b', 'a', 'c'], ranks: number[] = [2, 0, 1]): string {
	return JSON.stringify({
		version: 1,
		source: 'fixture',
		license: 'CC0-1.0',
		words,
		ranks,
	});
}

/** Stub `fetch` with a response; `headers` defaults to a matching content length. */
function stubFetch(
	text: string,
	headers: Record<string, string> = {
		'content-length': String(new TextEncoder().encode(text).byteLength),
	},
): ReturnType<typeof vi.fn> {
	const mock = vi.fn(async () => new Response(text, { headers }));
	vi.stubGlobal('fetch', mock);
	return mock;
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe('loadWordTokenizer', () => {
	it('loads, orders by rank, and wraps the words', async () => {
		vi.stubEnv('VITE_WORD_VOCAB_BASE_URL', BASE);
		const mock = stubFetch(body());

		const tokenizer = await loadWordTokenizer(INFO);

		expect(tokenizer.vocabSize).toBe(3);
		expect(tokenizer.idsToTokens(new Int32Array([0, 1, 2]))).toEqual(['a', 'c', 'b']);
		expect(mock).toHaveBeenCalledTimes(1);
		expect(mock.mock.calls[0]?.[0]).toBe(`${BASE}${WORD_VOCAB_FILE}`);
	});

	it('reports monotonic progress ending at 1', async () => {
		vi.stubEnv('VITE_WORD_VOCAB_BASE_URL', BASE);
		stubFetch(body());
		const fractions: number[] = [];

		await loadWordTokenizer(INFO, (progress) => {
			if (progress.fraction !== null) fractions.push(progress.fraction);
		});

		expect(fractions.length).toBeGreaterThan(0);
		expect(fractions.at(-1)).toBe(1);
		expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
	});

	it('clamps progress when content-length is smaller than the body', async () => {
		vi.stubEnv('VITE_WORD_VOCAB_BASE_URL', BASE);
		// A compressed response can advertise the compressed length while the
		// decoded body is larger, so raw `loaded / total` would exceed 1.
		stubFetch(body(), { 'content-length': '5' });
		const fractions: number[] = [];

		await loadWordTokenizer(INFO, (progress) => {
			if (progress.fraction !== null) fractions.push(progress.fraction);
		});

		expect(fractions.length).toBeGreaterThan(0);
		expect(fractions.every((fraction) => fraction <= 1)).toBe(true);
	});

	it('reports one null-fraction event without content-length', async () => {
		vi.stubEnv('VITE_WORD_VOCAB_BASE_URL', BASE);
		stubFetch(body(), {});
		const events: Array<{ loaded: number; total: number | null; fraction: number | null }> = [];

		await loadWordTokenizer(INFO, (progress) => events.push(progress));

		expect(events).toHaveLength(1);
		expect(events[0]?.total).toBeNull();
		expect(events[0]?.fraction).toBeNull();
	});

	it('rejects invalid JSON with a URL-prefixed error', async () => {
		vi.stubEnv('VITE_WORD_VOCAB_BASE_URL', BASE);
		stubFetch('not json');

		await expect(loadWordTokenizer(INFO)).rejects.toThrow(
			`Failed to load word vocabulary from ${BASE}${WORD_VOCAB_FILE}:`,
		);
	});

	it('keeps tokenizer-construction errors out of the URL prefix', async () => {
		vi.stubEnv('VITE_WORD_VOCAB_BASE_URL', BASE);
		stubFetch(body());
		vi.resetModules();
		// An empty word list passes parsing but makes the tokenizer constructor
		// throw, which must not be reported as an asset failure.
		vi.doMock('./word-vocab.js', () => ({ parseWordVocab: () => [] }));
		const { loadWordTokenizer: load } = await import('./word-vocab-loader.js');

		let caught: unknown;
		try {
			await load(INFO);
		} catch (error) {
			caught = error;
		} finally {
			vi.doUnmock('./word-vocab.js');
		}

		expect(caught).toBeInstanceOf(Error);
		const message = (caught as Error).message;
		expect(message).toContain('vocabulary must not be empty');
		expect(message).not.toContain(BASE);
	});

	it('rejects an invalid vocabulary with a URL-prefixed error', async () => {
		vi.stubEnv('VITE_WORD_VOCAB_BASE_URL', BASE);
		stubFetch(JSON.stringify({ version: 1 }));

		await expect(loadWordTokenizer(INFO)).rejects.toThrow(
			`Failed to load word vocabulary from ${BASE}${WORD_VOCAB_FILE}:`,
		);
	});
});
