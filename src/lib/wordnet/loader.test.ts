import { expect, it } from 'vitest';
import { decodeWordNet, loadWordNet, wordnetBaseUrl, WORDNET_CATEGORIES } from './loader.js';

const words = ['dog', 'canine'];
const bin = new ArrayBuffer(37);
const bytes = new Uint8Array(bin);
const view = new DataView(bin);
bytes.set(new TextEncoder().encode('OEWN'));
view.setUint32(4, 1, true);
view.setUint32(8, 1, true);
view.setUint32(12, 1, true);
bytes.set(new Uint8Array(new Int32Array([0, -1]).buffer), 16);
bytes.set(new Uint8Array(new Int32Array([0, 1]).buffer), 24);
bytes.set(new Uint8Array(new Int32Array([1]).buffer), 32);
bytes.set([0], 36);
const metaText = JSON.stringify({
	source: 'oewn-2025',
	vocabSha: '97b1689ef91765cb9b76ce1abe38138457cf764932cac37d141c0a7734f32226',
	vocabSize: 2,
	rows: 1,
	edgeCount: 1,
	categoryOrder: WORDNET_CATEGORIES,
});
const baseUrl = 'https://example.test/wordnet';
const response = (async (url: string) =>
	String(url).endsWith('.meta.json')
		? new Response(metaText)
		: new Response(bin)) as unknown as typeof fetch;

it('fetches on a miss and caches the bundle', async () => {
	let puts = 0;
	const bundle = await loadWordNet(words, {
		baseUrl,
		fetch: response,
		cache: { get: async () => undefined, put: async () => void puts++ },
	});
	expect([...bundle.rowMap]).toEqual([0, -1]);
	expect(puts).toBe(1);
});

it('skips the network on a hit', async () => {
	const cached = await decodeWordNet(metaText, bin, words);
	const bundle = await loadWordNet(words, {
		baseUrl,
		fetch: (() => Promise.reject(new Error('network'))) as unknown as typeof fetch,
		cache: { get: async () => cached, put: async () => undefined },
	});
	expect(bundle).toBe(cached);
});

function bundleWith(rowMap: [number, number], target: number): ArrayBuffer {
	const out = new ArrayBuffer(37);
	const bytes = new Uint8Array(out);
	const view = new DataView(out);
	bytes.set(new TextEncoder().encode('OEWN'));
	view.setUint32(4, 1, true);
	view.setUint32(8, 1, true);
	view.setUint32(12, 1, true);
	bytes.set(new Uint8Array(new Int32Array(rowMap).buffer), 16);
	bytes.set(new Uint8Array(new Int32Array([0, 1]).buffer), 24);
	bytes.set(new Uint8Array(new Int32Array([target]).buffer), 32);
	bytes.set([0], 36);
	return out;
}

it('rejects a target outside the vocabulary', async () => {
	await expect(decodeWordNet(metaText, bundleWith([0, -1], 2), words)).rejects.toThrow(
		'outside the vocabulary',
	);
});

it('rejects a target that resolves to its own row', async () => {
	await expect(decodeWordNet(metaText, bundleWith([0, 0], 1), words)).rejects.toThrow('own row');
});

it('rejects a vocab SHA mismatch', async () => {
	const bad = metaText.replace(/"vocabSha":"[^"]*"/, '"vocabSha":"00"');
	await expect(decodeWordNet(bad, bin, words)).rejects.toThrow('vocab SHA');
});

it('refuses an unpinned revision', () => {
	expect(() => wordnetBaseUrl()).toThrow('not pinned');
});
