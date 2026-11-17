import { expect, it } from 'vitest';
import {
	decodeWordNet,
	loadWordNet,
	wordnetBaseUrl,
	WORDNET_CATEGORIES,
	type WordNetBundle,
} from './loader.js';

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

const v2Synsets = ['oewn-00000001-n\tdog (n.)', 'oewn-00000002-n\tcanine (n.)'];
const v2MetaText = JSON.stringify({
	source: 'oewn-2025',
	vocabSha: '97b1689ef91765cb9b76ce1abe38138457cf764932cac37d141c0a7734f32226',
	vocabSize: 2,
	rows: 1,
	edgeCount: 1,
	synsetCount: v2Synsets.length,
	categoryOrder: WORDNET_CATEGORIES,
});

/** Hand-encoded v2: one dog → canine hypernym, synsets 0 → 1. */
function v2Bundle(): ArrayBuffer {
	const encoder = new TextEncoder();
	const entries = v2Synsets.map((entry) => encoder.encode(entry));
	const blobBytes = entries.reduce((total, entry) => total + entry.length, 0);
	const out = new ArrayBuffer(20 + 8 + 8 + 4 + 4 + 4 + 12 + 1 + blobBytes);
	const bytes = new Uint8Array(out);
	const view = new DataView(out);
	bytes.set(encoder.encode('OEWN'));
	view.setUint32(4, 2, true);
	view.setUint32(8, 1, true);
	view.setUint32(12, 1, true);
	view.setUint32(16, v2Synsets.length, true);
	let off = 20;
	bytes.set(new Uint8Array(new Int32Array([0, -1]).buffer), off);
	off += 8;
	bytes.set(new Uint8Array(new Int32Array([0, 1]).buffer), off);
	off += 8;
	bytes.set(new Uint8Array(new Int32Array([1]).buffer), off);
	off += 4;
	bytes.set(new Uint8Array(new Int32Array([0]).buffer), off);
	off += 4;
	bytes.set(new Uint8Array(new Int32Array([1]).buffer), off);
	off += 4;
	const synsetOffsets = new Int32Array(v2Synsets.length + 1);
	let at = 0;
	for (const [index, entry] of entries.entries()) {
		at += entry.length;
		synsetOffsets[index + 1] = at;
	}
	bytes.set(new Uint8Array(synsetOffsets.buffer), off);
	off += synsetOffsets.byteLength;
	bytes.set([0], off);
	off += 1;
	for (const entry of entries) {
		bytes.set(entry, off);
		off += entry.length;
	}
	return out;
}

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

it('decodes a v2 bundle with synset provenance', async () => {
	const bundle = await decodeWordNet(v2MetaText, v2Bundle(), words);
	expect(bundle.meta.synsetCount).toBe(2);
	expect([...bundle.sourceSynset]).toEqual([0]);
	expect([...bundle.targetSynset]).toEqual([1]);
	expect(bundle.synsetOffsets[0]).toBe(0);
	expect(bundle.synsetOffsets[1]).toBe(new TextEncoder().encode(v2Synsets[0]).length);
	expect(bundle.synsetOffsets[2]).toBe(bundle.synsetBlob.length);
	expect(new TextDecoder().decode(bundle.synsetBlob)).toBe(v2Synsets.join(''));
});

it('fills v1 provenance with -1 until the bundle is re-exported', async () => {
	const bundle = await decodeWordNet(metaText, bin, words);
	expect(bundle.meta.synsetCount).toBe(0);
	expect([...bundle.sourceSynset]).toEqual([-1]);
	expect([...bundle.targetSynset]).toEqual([-1]);
	expect(bundle.synsetBlob.length).toBe(0);
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

it('keys the cache by the vocabulary digest', async () => {
	const store = new Map<string, WordNetBundle>();
	let fetches = 0;
	const cache = {
		get: async (key: string) => store.get(key),
		put: async (key: string, value: WordNetBundle) => void store.set(key, value),
	};
	const counting = (async (url: string) => {
		fetches++;
		return response(url);
	}) as unknown as typeof fetch;
	await loadWordNet(words, { baseUrl, fetch: counting, cache });
	expect(fetches).toBe(2);
	await expect(loadWordNet(['dog', 'cat'], { baseUrl, fetch: counting, cache })).rejects.toThrow(
		'vocab SHA',
	);
	expect(fetches).toBe(4);
});

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
	expect(() => wordnetBaseUrl('')).toThrow('not pinned');
});
