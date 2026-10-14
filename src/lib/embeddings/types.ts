/**
 * Types for the embedding-space kNN noise substrate.
 *
 * The embedding matrix itself is **not shipped with the app**: a committed
 * Python script (`scripts/export_embeddings.py`) exports a quantized
 * `.bin` (+ transform + meta) from an LM checkpoint, and the app fetches
 * the artefacts from a configurable external URL, caching them in
 * IndexedDB. These types describe the on-disk (post-decode) shapes.
 */

/** Identifiers of the supported embedding sources. */
export type EmbeddingSourceId = 'bert-base-uncased' | 'gpt2' | 'gpt2-lmhead';

/** Registry metadata for one embedding source. */
export interface EmbeddingSourceInfo {
	/** Stable id (the registry key). */
	id: EmbeddingSourceId;
	/** Human label for the picker. */
	label: string;
	/** One-line description shown under the picker. */
	description: string;
	/**
	 * Tokenizer whose vocabulary indexes the embedding rows. Must match
	 * the app's active tokenizer — the worker validates it.
	 */
	tokenizerId: string;
	/** Embedding dimension $d$. */
	dim: number;
	/** Vocabulary size $K$ (number of rows). */
	vocabSize: number;
	/** Base file name of the exported artefacts (no extension). */
	fileName: string;
}

/** Preprocessing applied to embedding vectors before distance computation. */
export type PreprocessId = 'none' | 'mean-center' | 'center-remove-pcs' | 'whiten';

/** Distance metric over preprocessed vectors. */
export type MetricId = 'cosine' | 'l2';

/**
 * Header metadata for an exported embedding bundle (the `.meta.json`).
 * Field names mirror `scripts/export_embeddings.py`.
 */
export interface EmbeddingMeta {
	source: EmbeddingSourceId;
	model: string;
	vocabSize: number;
	dim: number;
	dtype: 'int8';
	quant: 'per-row-symmetric';
	nPcs: number;
}

/**
 * Transform bundle exported alongside the codes: mean vector ($d$), top-$n$
 * PC basis ($d \times n$, column-major), eigenvalues ($n$), whitening
 * matrix ($d \times d$, row-major). Layouts are documented in
 * `src/lib/embeddings/README.md`.
 */
export interface TransformBundle {
	mean: Float32Array;
	pcs: Float32Array;
	eigenvalues: Float32Array;
	whitening: Float32Array;
}

/** Dequantized-in-place view of the int8 matrix. */
export interface QuantizedMatrix {
	/** int8 codes, row-major $K \times d$. */
	codes: Int8Array;
	/** Per-row scale: $\mathrm{scale}_i = \max_j |W_{ij}| / 127$. */
	scales: Float32Array;
	vocabSize: number;
	dim: number;
}
