/**
 * Serve a miniature, vocab-aligned GloVe bundle to a Playwright page.
 *
 * The 40-word fixture vocabulary (ids $0 \ldots 39$) is embedded in a
 * $40 \times 300$ matrix whose rows encode a toy concept table: eight groups
 * of five consecutive ids, where a word in group $g$ has $+1$ in dimension
 * $g$ and $0$ elsewhere. With per-row scale $1/127$ this makes cosine
 * distance $0$ inside a group and $1$ across groups, so top-$k$ neighbours
 * are deterministic without shipping a real model.
 *
 * The transform is a no-op (zero mean, zero PCs, identity whitening), and the
 * meta/vocabulary pair carries the same `vocabSha` the worker recomputes from
 * the served word list.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

/** Shared word-vocabulary fixture (40 words, identity ranks). */
const VOCAB_FIXTURE = 'e2e/fixtures/word-vocab/word-vocab-50k.json';

const DIM = 300;
const N_PCS = 32;
/** Consecutive ids per concept group. */
const GROUP_SIZE = 5;

interface WordVocabFixture {
	words: string[];
	ranks: number[];
}

/** Read the fixture and return its words ordered by rank (= static id). */
function orderedWords(): string[] {
	const fixture = JSON.parse(readFileSync(VOCAB_FIXTURE, 'utf8')) as WordVocabFixture;
	const ordered: string[] = new Array<string>(fixture.words.length);
	for (let i = 0; i < fixture.words.length; i++) {
		ordered[fixture.ranks[i]!] = fixture.words[i]!;
	}
	return ordered;
}

/** Build the int8 codes for the toy concept table. */
function conceptCodes(vocabSize: number): Int8Array {
	const codes = new Int8Array(vocabSize * DIM);
	for (let row = 0; row < vocabSize; row++) {
		codes[row * DIM + Math.floor(row / GROUP_SIZE)] = 1;
	}
	return codes;
}

/** Build the no-op transform bundle (mean, PCs, eigenvalues, whitening). */
function identityTransform(): Float32Array {
	const out = new Float32Array(DIM + DIM * N_PCS + N_PCS + DIM * DIM);
	let offset = DIM; // zero mean
	offset += DIM * N_PCS; // zero PCs
	offset += N_PCS; // zero eigenvalues
	for (let i = 0; i < DIM; i++) out[offset + i * DIM + i] = 1;
	return out;
}

/**
 * Route the four GloVe artefacts and the word vocabulary to in-memory
 * fixtures. Call before `page.goto`.
 */
export async function installTinyGloveBundle(page: Page): Promise<{ words: string[] }> {
	const words = orderedWords();
	const vocabSize = words.length;
	const meta = {
		source: 'glove-840b-300d',
		model: 'glove.840B.300d',
		vocabSize,
		dim: DIM,
		dtype: 'int8',
		quant: 'per-row-symmetric',
		nPcs: N_PCS,
		vocabSha: createHash('sha256').update(words.join('\n'), 'utf8').digest('hex'),
	};
	const codes = conceptCodes(vocabSize);
	const scales = new Float32Array(vocabSize).fill(1 / 127);
	const transform = identityTransform();

	await page.route('**/glove-840b-300d.meta.json', (route) =>
		route.fulfill({ contentType: 'application/json', body: JSON.stringify(meta) }),
	);
	await page.route('**/glove-840b-300d.int8.bin', (route) =>
		route.fulfill({
			contentType: 'application/octet-stream',
			body: Buffer.from(codes.buffer),
		}),
	);
	await page.route('**/glove-840b-300d.scales.f32.bin', (route) =>
		route.fulfill({
			contentType: 'application/octet-stream',
			body: Buffer.from(scales.buffer),
		}),
	);
	await page.route('**/glove-840b-300d.transform.f32.bin', (route) =>
		route.fulfill({
			contentType: 'application/octet-stream',
			body: Buffer.from(transform.buffer),
		}),
	);
	await page.route('**/word-vocab-50k.json', (route) =>
		route.fulfill({ path: VOCAB_FIXTURE, contentType: 'application/json' }),
	);

	return { words };
}
