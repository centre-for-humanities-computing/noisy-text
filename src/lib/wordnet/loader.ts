import { HF_DATASET_REPO, hfResolvePrefix, shortHash } from '../embeddings/loader.js';
import { idbGet, idbPut, WORDNET_STORE } from '../embeddings/idb.js';
import { wordVocabSha } from '../embeddings/vocab-sha.js';

/** Decode, validate and cache the OEWN 2025 bundle (see README.md). */
export const WORDNET_SOURCE = 'oewn-2025';
export const WORDNET_CATEGORIES = ['hypernym', 'hyponym', 'synonym', 'meronym', 'holonym'] as const;
export type WordNetCategory = (typeof WORDNET_CATEGORIES)[number];
export const WORDNET_DATASET_REVISION = '4907ef919e851b3fce75c169debd8caa2214de5f';
export interface WordNetMeta {
	source: string;
	license: string;
	attribution: string;
	vocabSha: string;
	vocabSize: number;
	rows: number;
	edgeCount: number;
	synsetCount: number;
	coveredLemmas: number;
	categoryOrder: WordNetCategory[];
}

export interface WordNetBundle {
	meta: WordNetMeta;
	rowMap: Int32Array;
	offsets: Int32Array;
	targets: Int32Array;
	/** Source synset index per edge; `-1` in a v1 bundle. */
	sourceSynset: Int32Array;
	/** Target synset index per edge; `-1` in a v1 bundle. */
	targetSynset: Int32Array;
	/** `synsetCount + 1` CSR offsets into `synsetBlob`. */
	synsetOffsets: Int32Array;
	/** Concatenated `<id>\t<label>` UTF-8 entries. */
	synsetBlob: Uint8Array;
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
	const version = view.getUint32(4, true);
	if (magic !== 'OEWN' || (version !== 1 && version !== 2)) fail('bad header');
	const rows = view.getUint32(8, true),
		edgeCount = view.getUint32(12, true);
	if (rows !== meta.rows || edgeCount !== meta.edgeCount) fail('header disagrees with manifest');
	const synsetCount = version === 2 ? view.getUint32(16, true) : 0;
	if (version === 2 && synsetCount !== meta.synsetCount) fail('header disagrees with manifest');

	const header = version === 2 ? 20 : 16;
	const fixed =
		header +
		words.length * 4 +
		(rows + 1) * 4 +
		edgeCount * 4 +
		(version === 2 ? edgeCount * 8 + (synsetCount + 1) * 4 : 0) +
		edgeCount;
	if (buffer.byteLength < fixed) fail(`section lengths disagree: ${buffer.byteLength} bytes`);
	if (version === 1 && buffer.byteLength !== fixed) {
		fail(`section lengths disagree: ${buffer.byteLength} bytes`);
	}

	let off = header;
	const rowMap = new Int32Array(buffer, off, words.length);
	off += words.length * 4;
	const offsets = new Int32Array(buffer, off, rows + 1);
	off += (rows + 1) * 4;
	const targets = new Int32Array(buffer, off, edgeCount);
	off += edgeCount * 4;
	let sourceSynset = new Int32Array(0);
	let targetSynset = new Int32Array(0);
	let synsetOffsets = new Int32Array(1);
	let synsetBlob = new Uint8Array(0);
	if (version === 2) {
		sourceSynset = new Int32Array(buffer, off, edgeCount);
		off += edgeCount * 4;
		targetSynset = new Int32Array(buffer, off, edgeCount);
		off += edgeCount * 4;
		synsetOffsets = new Int32Array(buffer, off, synsetCount + 1);
		off += (synsetCount + 1) * 4;
	} else {
		sourceSynset = new Int32Array(edgeCount).fill(-1);
		targetSynset = new Int32Array(edgeCount).fill(-1);
	}
	const categories = new Uint8Array(buffer, off, edgeCount);
	off += edgeCount;
	if (version === 2) synsetBlob = new Uint8Array(buffer, off);

	if (offsets[0] !== 0 || offsets[rows] !== edgeCount) fail('bad CSR offsets');
	for (let row = 0; row < rows; row++) {
		const start = offsets[row]!;
		const end = offsets[row + 1]!;
		for (let edge = start; edge < end; edge++) {
			const target = targets[edge]!;
			if (target < 0 || target >= words.length) fail(`target ${target} outside the vocabulary`);
			if (rowMap[target] === row) fail(`target ${target} resolves to its own row`);
			if (version === 2) {
				const source = sourceSynset[edge]!;
				const destination = targetSynset[edge]!;
				if (source < 0 || source >= synsetCount)
					fail(`source synset ${source} outside the synset table`);
				if (destination < 0 || destination >= synsetCount)
					fail(`target synset ${destination} outside the synset table`);
			}
		}
	}
	if (version === 2) {
		if (synsetOffsets[0] !== 0 || synsetOffsets[synsetCount] !== synsetBlob.byteLength) {
			fail('bad synset offsets');
		}
		for (let index = 0; index < synsetCount; index++) {
			if (synsetOffsets[index]! > synsetOffsets[index + 1]!) fail('bad synset offsets');
		}
	}

	return {
		meta: version === 2 ? meta : { ...meta, synsetCount: 0 },
		rowMap,
		offsets,
		targets,
		sourceSynset,
		targetSynset,
		synsetOffsets,
		synsetBlob,
		categories,
	};
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
