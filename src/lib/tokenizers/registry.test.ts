import { afterEach, describe, it, expect, vi } from 'vitest';
import { TOKENIZERS, loadTokenizer } from './registry.js';
import type { Tokenizer } from './types.js';

/** A promise plus its settlement handles, for gating a mocked loader. */
function deferred<T>(): {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (error: unknown) => void;
} {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/** Import a fresh registry whose loaders are replaced by `loader`. */
async function freshRegistry(loader: ReturnType<typeof vi.fn>) {
	vi.resetModules();
	vi.doMock('./word-vocab-loader.js', () => ({ loadWordTokenizer: loader }));
	vi.doMock('./hf-tokenizer.js', () => ({ loadHfTokenizer: loader }));
	const { loadTokenizer: load } = await import('./registry.js');
	return load;
}

afterEach(() => {
	vi.doUnmock('./word-vocab-loader.js');
	vi.doUnmock('./hf-tokenizer.js');
	vi.resetModules();
});

describe('tokenizer registry', () => {
	it('contains at least three tokenizers', () => {
		const ids = Object.keys(TOKENIZERS);
		expect(ids.length).toBeGreaterThanOrEqual(3);
	});

	it('every entry has the required shape', () => {
		for (const [id, info] of Object.entries(TOKENIZERS)) {
			expect(info.id).toBe(id);
			expect(typeof info.label).toBe('string');
			expect(info.label.length).toBeGreaterThan(0);
			expect(typeof info.description).toBe('string');
			expect(info.description.length).toBeGreaterThan(0);
			expect(typeof info.wordPiece).toBe('boolean');
			expect(info.plainName.length).toBeGreaterThan(0);
			expect(info.gloss.length).toBeGreaterThan(0);
			expect(info.tooltip.text.length).toBeGreaterThan(0);
		}
		expect(TOKENIZERS.gpt2?.wordPiece).toBe(false);
		expect(TOKENIZERS['bert-base-uncased']?.wordPiece).toBe(true);
	});

	it('describes the hosted word tokenizer', () => {
		const words = TOKENIZERS.words;
		expect(words).toBeDefined();
		expect(words?.id).toBe('words');
		expect(words?.label).toBe('Word vocabulary (50k)');
		expect(words?.wordPiece).toBe(false);
		expect(words?.plainName.length).toBeGreaterThan(0);
		expect(words?.gloss.length).toBeGreaterThan(0);
		expect(words?.tooltip.text.length).toBeGreaterThan(0);
		expect(words?.tooltip.math).toContain('50{,}000');
	});

	it('ids are unique', () => {
		const ids = Object.keys(TOKENIZERS);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('throws for an unknown id', async () => {
		await expect(loadTokenizer('nope')).rejects.toThrow(/Unknown tokenizer "nope"/);
	});

	it('shares one in-flight load between concurrent callers', async () => {
		const gate = deferred<Tokenizer>();
		const loader = vi.fn(() => gate.promise);
		const load = await freshRegistry(loader);
		const tokenizer = { vocabSize: 1 } as unknown as Tokenizer;

		const first = load('words');
		const second = load('words');
		await Promise.resolve(); // let the deferred loader start
		expect(loader).toHaveBeenCalledTimes(1);

		gate.resolve(tokenizer);
		await expect(first).resolves.toBe(tokenizer);
		await expect(second).resolves.toBe(tokenizer);
	});

	it('serves a resolved load from the cache without loading again', async () => {
		const loader = vi.fn(async () => ({ vocabSize: 1 }) as unknown as Tokenizer);
		const load = await freshRegistry(loader);

		const first = await load('words');
		const second = await load('words');

		expect(second).toBe(first);
		expect(loader).toHaveBeenCalledTimes(1);
	});

	it('evicts a rejected load so a retry loads again', async () => {
		const gate = deferred<Tokenizer>();
		const tokenizer = { vocabSize: 1 } as unknown as Tokenizer;
		const loader = vi
			.fn()
			.mockImplementationOnce(() => gate.promise)
			.mockResolvedValueOnce(tokenizer);
		const load = await freshRegistry(loader);

		const failed = load('words');
		gate.reject(new Error('network down'));
		await expect(failed).rejects.toThrow('network down');

		await expect(load('words')).resolves.toBe(tokenizer);
		expect(loader).toHaveBeenCalledTimes(2);
	});
});
