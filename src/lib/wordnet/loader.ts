import { HF_DATASET_REPO, hfResolvePrefix, shortHash } from '../embeddings/loader.js';
import { idbGet, idbPut, WORDNET_STORE } from '../embeddings/idb.js';
import { wordVocabSha } from '../embeddings/vocab-sha.js';

/** Decode, validate and cache the OEWN 2025 bundle (see README.md). */
export const WORDNET_SOURCE = 'oewn-2025';
export const WORDNET_CATEGORIES = ['hypernym', 'hyponym', 'synonym', 'meronym', 'holonym'] as const;
export type WordNetCategory = (typeof WORDNET_CATEGORIES)[number];
export const WORDNET_DATASET_REVISION = '';
export interface WordNetMeta {
	source: string;
	license: string;
	attribution: string;
	vocabSha: string;
	vocabSize: number;
	rows: number;
	edgeCount: number;
	coveredLemmas: number;
	categoryOrder: WordNetCategory[];
}

export interface WordNetBundle {
	meta: WordNetMeta;
	rowMap: Int32Array;
	offsets: Int32Array;
	targets: Int32Array;
	categories: Uint8Array;
}

export interface WordNetCache {
	get(key: string): Promise<WordNetBundle | undefined>;
	put(key: string, value: WordNetBundle): Promise<void>;
}

const idbCache: WordNetCache = {
	get: (key) => idbGet<WordNetBundle>(WORDNET_STORE, key),
	put: (key, value) => idbPut(WORDNET_STORE, key, value),
};
function fail(reason: string): never {
	throw new Error(`WordNet: ${reason}`);
}

export function wordnetBaseUrl(revision = WORDNET_DATASET_REVISION): string {
	if (!revision) fail('WORDNET_DATASET_REVISION is not pinned; upload the bundle and set the sha');
	return hfResolvePrefix(HF_DATASET_REPO, revision);
}

export async function decodeWordNet(
	metaText: string,
	buffer: ArrayBuffer,
	words: readonly string[],
	vocabSha?: string,
): Promise<WordNetBundle> {
	const meta = JSON.parse(metaText) as WordNetMeta;
	if (meta.source !== WORDNET_SOURCE) fail(`source mismatch: ${meta.source}`);
	if (meta.vocabSize !== words.length) fail(`vocab size mismatch: ${meta.vocabSize}`);
	if (meta.categoryOrder.join('\n') !== WORDNET_CATEGORIES.join('\n'))
		fail('unexpected category order');
	const sha = vocabSha ?? (await wordVocabSha(words));
	if (meta.vocabSha !== sha) fail(`vocab SHA mismatch: expected ${meta.vocabSha}, got ${sha}`);

	const view = new DataView(buffer);
	const magic = new TextDecoder().decode(new Uint8Array(buffer, 0, 4));
	if (magic !== 'OEWN' || view.getUint32(4, true) !== 1) fail('bad header');
	const rows = view.getUint32(8, true),
		edgeCount = view.getUint32(12, true);
	if (rows !== meta.rows || edgeCount !== meta.edgeCount) fail('header disagrees with manifest');
	if (buffer.byteLength !== 16 + words.length * 4 + (rows + 1) * 4 + edgeCount * 5) {
		fail(`section lengths disagree: ${buffer.byteLength} bytes`);
	}

	let off = 16;
	const rowMap = new Int32Array(buffer, off, words.length);
	off += words.length * 4;
	const offsets = new Int32Array(buffer, off, rows + 1);
	off += (rows + 1) * 4;
	const targets = new Int32Array(buffer, off, edgeCount);
	off += edgeCount * 4;
	const categories = new Uint8Array(buffer, off, edgeCount);
	if (offsets[0] !== 0 || offsets[rows] !== edgeCount) fail('bad CSR offsets');
	for (let row = 0; row < rows; row++) {
		const start = offsets[row]!;
		const end = offsets[row + 1]!;
		for (let edge = start; edge < end; edge++) {
			const target = targets[edge]!;
			if (target < 0 || target >= words.length) fail(`target ${target} outside the vocabulary`);
			if (rowMap[target] === row) fail(`target ${target} resolves to its own row`);
		}
	}
	return { meta, rowMap, offsets, targets, categories };
}

export interface LoadWordNetOptions {
	cache?: WordNetCache;
	/** Test-only override for the pinned resolve prefix. */
	baseUrl?: string;
	fetch?: typeof fetch;
}

export async function loadWordNet(
	words: readonly string[],
	options: LoadWordNetOptions = {},
): Promise<WordNetBundle> {
	const base = (options.baseUrl ?? wordnetBaseUrl()).replace(/\/$/, '');
	const cache = options.cache ?? idbCache;
	const doFetch = options.fetch ?? fetch;
	const sha = await wordVocabSha(words);
	const key = `${WORDNET_SOURCE}@${shortHash(base)}@${sha}`;

	const cached = await cache.get(key);
	if (cached) return cached;

	const metaRes = await doFetch(`${base}/${WORDNET_SOURCE}.meta.json`);
	if (!metaRes.ok) fail(`manifest HTTP ${metaRes.status}`);
	const binRes = await doFetch(`${base}/${WORDNET_SOURCE}.bin`);
	if (!binRes.ok) fail(`bundle HTTP ${binRes.status}`);
	const bundle = await decodeWordNet(await metaRes.text(), await binRes.arrayBuffer(), words, sha);
	await cache.put(key, bundle);
	return bundle;
}
