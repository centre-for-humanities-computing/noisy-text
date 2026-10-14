import type {
	EmbeddingMeta,
	EmbeddingSourceId,
	QuantizedMatrix,
	TransformBundle,
} from './types.js';
import { getEmbeddingSource } from './sources.js';
import { idbGet, idbPut, hasIndexedDb } from './idb.js';

/**
 * Fetch + decode + cache embedding bundles.
 *
 * Artefacts live at a configurable external URL (no binaries in git):
 * `<base>/<fileName>.int8.bin`, `.scales.f32.bin`, `.transform.f32.bin`,
 * `.meta.json`. Bundles are cached in IndexedDB (`matrices` store, keyed
 * by source); an IDB hit skips the network entirely.
 *
 * Byte progress is reported per artefact as `(loaded, total)` per file —
 * the caller converts to its own phase units.
 */

/**
 * Base URL of the hosted export artefacts. Override at build time with
 * `VITE_EMBEDDING_BASE_URL` (see `src/lib/embeddings/README.md`); the
 * default is a placeholder that must be configured before the
 * embedding-knn strategy can fetch real data.
 */
export const EMBEDDING_BASE_URL: string =
	(import.meta.env.VITE_EMBEDDING_BASE_URL as string | undefined) ??
	'https://embeddings.noisy-text.invalid';

/** Progress callback: bytes loaded and total for the current artefact. */
export type ByteProgress = (loaded: number, total: number) => void;

export interface LoadedEmbedding {
	matrix: QuantizedMatrix;
	transform: TransformBundle;
	meta: EmbeddingMeta;
}

interface CachedBundle {
	meta: EmbeddingMeta;
	codes: Int8Array;
	scales: Float32Array;
	mean: Float32Array;
	pcs: Float32Array;
	eigenvalues: Float32Array;
	whitening: Float32Array;
}

/** Bundle shape stored in IndexedDB (structured-cloneable typed arrays). */
const MATRIX_STORE = 'matrices';

async function fetchBytes(url: string, onProgress?: ByteProgress): Promise<ArrayBuffer> {
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
	}
	const total = Number(res.headers.get('content-length') ?? 0);
	if (!res.body || !total || !onProgress) {
		return res.arrayBuffer();
	}
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let loaded = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) {
			chunks.push(value);
			loaded += value.byteLength;
			onProgress(loaded, total);
		}
	}
	const out = new Uint8Array(loaded);
	let off = 0;
	for (const c of chunks) {
		out.set(c, off);
		off += c.byteLength;
	}
	return out.buffer;
}

/** Decode raw bytes into a `Float32Array` view (copy for IDB safety). */
function decodeF32(buffer: ArrayBuffer): Float32Array {
	return new Float32Array(buffer.slice(0));
}

/** Assemble a decoded bundle into the public shape. */
function assemble(cached: CachedBundle): LoadedEmbedding {
	const matrix: QuantizedMatrix = {
		codes: cached.codes,
		scales: cached.scales,
		vocabSize: cached.meta.vocabSize,
		dim: cached.meta.dim,
	};
	const transform: TransformBundle = {
		mean: cached.mean,
		pcs: cached.pcs,
		eigenvalues: cached.eigenvalues,
		whitening: cached.whitening,
	};
	return { matrix, transform, meta: cached.meta };
}

/**
 * Load an embedding bundle for `sourceId`: IndexedDB hit → decode; miss
 * → fetch the three `.bin` files + meta, cache, decode. Throws when the
 * network fetch fails and nothing is cached.
 */
export async function loadEmbedding(
	sourceId: EmbeddingSourceId,
	onProgress?: ByteProgress,
): Promise<LoadedEmbedding> {
	const info = getEmbeddingSource(sourceId);

	if (hasIndexedDb()) {
		const cached = await idbGet<CachedBundle>(MATRIX_STORE, sourceId);
		if (cached && cached.meta && cached.codes && cached.scales) {
			return assemble(cached);
		}
	}

	const base = `${EMBEDDING_BASE_URL.replace(/\/$/, '')}/${info.fileName}`;
	const metaBytes = await fetchBytes(`${base}.meta.json`, onProgress);
	const metaText = new TextDecoder().decode(metaBytes);
	const meta = JSON.parse(metaText) as EmbeddingMeta;
	if (meta.source !== sourceId) {
		throw new Error(`Embedding meta source mismatch: expected ${sourceId}, got ${meta.source}`);
	}
	const codesBytes = await fetchBytes(`${base}.int8.bin`, onProgress);
	const scalesBytes = await fetchBytes(`${base}.scales.f32.bin`, onProgress);
	const transformBytes = await fetchBytes(`${base}.transform.f32.bin`, onProgress);

	const codes = new Int8Array(codesBytes);
	const scales = decodeF32(scalesBytes);
	const allF32 = decodeF32(transformBytes);

	// Transform layout (documented in README.md):
	//   mean        : d floats
	//   pcs         : d * nPcs floats, row-major
	//   eigenvalues : nPcs floats
	//   whitening   : d * d floats, row-major
	const d = meta.dim;
	const nPcs = meta.nPcs;
	const meanLen = d;
	const pcsLen = d * nPcs;
	const eigLen = nPcs;
	const whitenLen = d * d;
	const expected = meanLen + pcsLen + eigLen + whitenLen;
	if (allF32.length !== expected) {
		throw new Error(
			`Transform blob size mismatch for ${sourceId}: got ${allF32.length} floats, expected ${expected}`,
		);
	}
	let off = 0;
	const mean = allF32.slice(off, off + meanLen);
	off += meanLen;
	const pcs = allF32.slice(off, off + pcsLen);
	off += pcsLen;
	const eigenvalues = allF32.slice(off, off + eigLen);
	off += eigLen;
	const whitening = allF32.slice(off, off + whitenLen);

	const bundle: CachedBundle = {
		meta,
		codes,
		scales,
		mean,
		pcs,
		eigenvalues,
		whitening,
	};

	void idbPut(MATRIX_STORE, sourceId, bundle);
	return assemble(bundle);
}
