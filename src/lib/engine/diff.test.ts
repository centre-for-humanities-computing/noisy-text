import { describe, it, expect } from 'vitest';
import {
	countChanged,
	changedMask,
	recencyAt,
	allTokenCharSpans,
	alignTokenPieces,
} from './diff.js';
import type { TokenPiece } from './diff.js';
import seedrandom from 'seedrandom';
import type { Trajectory } from './types.js';

/** Build a minimal Trajectory from a 2D array of rows for testing. */
function makeTraj(rows: number[][]): Trajectory {
	const T = rows.length - 1;
	const L = rows[0]!.length;
	const flat = new Int32Array((T + 1) * L);
	for (let t = 0; t <= T; t++) {
		flat.set(rows[t]!, t * L);
	}
	return {
		rows: flat,
		T,
		length: L,
		seed: 0,
		tokensAt(t: number): Int32Array {
			return flat.subarray(t * L, (t + 1) * L);
		},
	};
}

describe('countChanged', () => {
	it('returns 0 for identical arrays', () => {
		const a = new Int32Array([0, 1, 2, 3]);
		expect(countChanged(a, a)).toBe(0);
	});

	it('returns length for fully-different arrays', () => {
		const a = new Int32Array([0, 0, 0, 0]);
		const b = new Int32Array([1, 2, 3, 4]);
		expect(countChanged(a, b)).toBe(4);
	});

	it('counts only changed positions', () => {
		const a = new Int32Array([1, 2, 3, 4, 5]);
		const b = new Int32Array([1, 9, 3, 9, 5]);
		expect(countChanged(a, b)).toBe(2);
	});

	it('throws on length mismatch', () => {
		const a = new Int32Array(3);
		const b = new Int32Array(4);
		expect(() => countChanged(a, b)).toThrow('Length mismatch');
	});
});

describe('changedMask', () => {
	it('returns all zeros for identical arrays', () => {
		const a = new Int32Array([1, 2, 3]);
		const mask = changedMask(a, a);
		expect(mask.length).toBe(3);
		expect(mask[0]).toBe(0);
		expect(mask[1]).toBe(0);
		expect(mask[2]).toBe(0);
	});

	it('returns all ones for fully-different arrays', () => {
		const a = new Int32Array([0, 0, 0]);
		const b = new Int32Array([1, 1, 1]);
		const mask = changedMask(a, b);
		expect(mask[0]).toBe(1);
		expect(mask[1]).toBe(1);
		expect(mask[2]).toBe(1);
	});

	it('reuses output buffer when provided', () => {
		const a = new Int32Array([1, 2, 3, 4]);
		const b = new Int32Array([1, 9, 3, 9]);
		const out = new Uint8Array(4);
		out[0] = 255; // pre-fill to verify overwrite

		const mask = changedMask(a, b, out);
		expect(mask).toBe(out);
		expect(mask[0]).toBe(0); // was 255, now overwritten
		expect(mask[1]).toBe(1);
		expect(mask[2]).toBe(0);
		expect(mask[3]).toBe(1);
	});

	it('throws on length mismatch', () => {
		const a = new Int32Array(3);
		const b = new Int32Array(4);
		expect(() => changedMask(a, b)).toThrow('Length mismatch');
	});
});

describe('recencyAt', () => {
	it('returns all zeros at t=0', () => {
		// x_0 = [1,2,3], x_1 = [9,9,9] — but t=0 so no lookback.
		const traj = makeTraj([
			[1, 2, 3],
			[9, 9, 9],
		]);
		const r = recencyAt(traj, 0, 4);
		expect(r[0]).toBe(0);
		expect(r[1]).toBe(0);
		expect(r[2]).toBe(0);
	});

	it('returns 1 for positions that changed at current step', () => {
		// x_0 = [1,2,3], x_1 = [9,2,3] — only position 0 changed.
		const traj = makeTraj([
			[1, 2, 3],
			[9, 2, 3],
		]);
		const r = recencyAt(traj, 1, 4);
		expect(r[0]).toBeCloseTo(1);
		expect(r[1]).toBe(0);
		expect(r[2]).toBe(0);
	});

	it('fades recency over multiple steps', () => {
		// x_0 = [1,2], x_1 = [9,2] (pos 0 changed at t=1),
		// x_2 = [9,8] (pos 1 changed at t=2).
		const traj = makeTraj([
			[1, 2],
			[9, 2],
			[9, 8],
		]);
		const r = recencyAt(traj, 2, 4);
		// pos 0 changed 1 step ago → 1 - 1/4 = 0.75
		expect(r[0]).toBeCloseTo(0.75);
		// pos 1 changed at current step → 1
		expect(r[1]).toBeCloseTo(1);
	});

	it('returns 0 for positions unchanged within window', () => {
		// x_0 = [1,2], x_1 = [9,2], x_2 = [9,2], x_3 = [9,2].
		// pos 0 changed at t=1, window=2, t=3 → stepsAgo=2, 1-2/2=0.
		const traj = makeTraj([
			[1, 2],
			[9, 2],
			[9, 2],
			[9, 2],
		]);
		const r = recencyAt(traj, 3, 2);
		expect(r[0]).toBe(0);
		expect(r[1]).toBe(0);
	});

	it('reuses output buffer when provided', () => {
		const traj = makeTraj([
			[1, 2],
			[9, 2],
		]);
		const out = new Float32Array(2);
		out[0] = 99; // pre-fill to verify overwrite
		const r = recencyAt(traj, 1, 4, out);
		expect(r).toBe(out);
		expect(r[0]).toBeCloseTo(1);
		expect(r[1]).toBe(0);
	});

	it('handles window=1 (only current step matters)', () => {
		const traj = makeTraj([
			[1, 2],
			[9, 2],
			[9, 8],
		]);
		const r = recencyAt(traj, 2, 1);
		// pos 0 changed at t=1, window=1, t=2 → stepsAgo=1, 1-1/1=0.
		expect(r[0]).toBe(0);
		// pos 1 changed at t=2 → 1.
		expect(r[1]).toBeCloseTo(1);
	});
});

describe('allTokenCharSpans', () => {
	/** Stub decoder: each token id maps to a fixed-length string. */
	function decode(id: number): string {
		if (id === 0) return '';
		if (id === 99) return '[MASK]';
		return `t${id}`;
	}

	it('returns empty for empty input', () => {
		const ids = new Int32Array(0);
		const recency = new Float32Array(0);
		expect(allTokenCharSpans(ids, recency, decode, 99, '')).toEqual([]);
	});

	it('emits one span per visible token', () => {
		const ids = new Int32Array([1, 2, 3]);
		const recency = new Float32Array([0, 0, 0]);
		const spans = allTokenCharSpans(ids, recency, decode, 99, 't1t2t3');
		expect(spans).toHaveLength(3);
		expect(spans.map((s) => s.tokenId)).toEqual([1, 2, 3]);
	});

	it('computes contiguous character positions', () => {
		// ids [1, 2, 3] → "t1t2t3" (each 2 chars)
		const ids = new Int32Array([1, 2, 3]);
		const recency = new Float32Array([0, 0, 0]);
		const spans = allTokenCharSpans(ids, recency, decode, 99, 't1t2t3');
		expect(spans[0]).toMatchObject({ start: 0, end: 2 });
		expect(spans[1]).toMatchObject({ start: 2, end: 4 });
		expect(spans[2]).toMatchObject({ start: 4, end: 6 });
	});

	it('skips mask sentinel positions', () => {
		const ids = new Int32Array([1, 99, 3]);
		const recency = new Float32Array([0, 0, 0]);
		const spans = allTokenCharSpans(ids, recency, decode, 99, 't1t3');
		expect(spans).toHaveLength(2);
		expect(spans.map((s) => s.tokenId)).toEqual([1, 3]);
	});

	it('skips empty-decoded tokens', () => {
		const ids = new Int32Array([1, 0, 3]);
		const recency = new Float32Array([0, 0, 0]);
		const spans = allTokenCharSpans(ids, recency, decode, 99, 't1t3');
		expect(spans).toHaveLength(2);
		// "t1" then "t3": positions 0-2 and 2-4.
		expect(spans[1]).toMatchObject({ start: 2, end: 4 });
	});

	it('carries recency per token', () => {
		const ids = new Int32Array([1, 2]);
		const recency = new Float32Array([0.5, 1]);
		const spans = allTokenCharSpans(ids, recency, decode, 99, 't1t2');
		expect(spans[0]!.recency).toBe(0.5);
		expect(spans[1]!.recency).toBe(1);
	});

	it('preserves original position index', () => {
		const ids = new Int32Array([1, 99, 3]);
		const recency = new Float32Array([0, 0, 0]);
		const spans = allTokenCharSpans(ids, recency, decode, 99, 't1t3');
		expect(spans[0]!.index).toBe(0);
		expect(spans[1]!.index).toBe(2);
	});

	it('omits non-ASCII GPT-2 tokens that decode to U+FFFD', () => {
		// GPT-2 byte-level isolated decodes of non-ASCII text yield U+FFFD.
		const replacement = (): string => '\uFFFD';
		const ids = new Int32Array([1, 2, 3, 4]);
		const recency = new Float32Array(4);
		const spans = allTokenCharSpans(ids, recency, replacement, 99, '你好世界');
		// The prose text itself is correct; only the highlights are omitted.
		expect(spans).toEqual([]);
	});

	it('omits an unalignable piece without shifting later spans', () => {
		const decoder = (id: number): string => {
			if (id === 1) return 'ab';
			if (id === 2) return 'zz';
			if (id === 3) return 'cd';
			return '';
		};
		const ids = new Int32Array([1, 2, 3]);
		const recency = new Float32Array(3);
		const spans = allTokenCharSpans(ids, recency, decoder, 99, 'abcd');
		// 'zz' cannot be located, so it is dropped; 'cd' keeps its position.
		expect(spans).toHaveLength(2);
		expect(spans[0]).toMatchObject({ tokenId: 1, start: 0, end: 2 });
		expect(spans[1]).toMatchObject({ tokenId: 3, start: 2, end: 4 });
	});
});

describe('alignTokenPieces', () => {
	function pieces(texts: string[]): TokenPiece[] {
		return texts.map((text, i) => ({ index: i, tokenId: i, text }));
	}

	it('aligns exact concatenation', () => {
		const spans = alignTokenPieces('abc', pieces(['a', 'b', 'c']));
		expect(spans).toEqual([
			{ start: 0, end: 1 },
			{ start: 1, end: 2 },
			{ start: 2, end: 3 },
		]);
	});

	it('aligns space-joined BERT-style pieces', () => {
		const spans = alignTokenPieces('hello world', pieces(['hello', 'world']));
		expect(spans).toEqual([
			{ start: 0, end: 5 },
			{ start: 6, end: 11 },
		]);
	});

	it('aligns ## continuation pieces', () => {
		const spans = alignTokenPieces('playing', pieces(['play', 'ing']));
		expect(spans).toEqual([
			{ start: 0, end: 4 },
			{ start: 4, end: 7 },
		]);
	});

	it('aligns pieces across punctuation cleanup', () => {
		const spans = alignTokenPieces('hello, world', pieces(['hello', ',', 'world']));
		expect(spans).toEqual([
			{ start: 0, end: 5 },
			{ start: 5, end: 6 },
			{ start: 7, end: 12 },
		]);
	});

	it('aligns GPT-2-style leading-space pieces', () => {
		const spans = alignTokenPieces('hello world', pieces(['hello', ' world']));
		expect(spans).toEqual([
			{ start: 0, end: 5 },
			{ start: 5, end: 11 },
		]);
	});

	it('keeps empty pieces at the cursor', () => {
		const spans = alignTokenPieces('abc', pieces(['a', '', 'bc']));
		expect(spans).toEqual([
			{ start: 0, end: 1 },
			{ start: 1, end: 1 },
			{ start: 1, end: 3 },
		]);
	});

	it('falls back to indexOf for unexpected intervening characters', () => {
		const spans = alignTokenPieces('abXcd', pieces(['ab', 'cd']));
		expect(spans).toEqual([
			{ start: 0, end: 2 },
			{ start: 3, end: 5 },
		]);
	});
});

describe('allTokenCharSpans (WordPiece-style decoder)', () => {
	/** Raw vocab: `##` prefix marks WordPiece continuations. */
	const vocab = ['play', '##ing', 'dog', 'fast'];
	const MASK = 99;

	/** The text a piece contributes after WordPiece normalization. */
	function pieceText(id: number): string {
		const raw = vocab[id] ?? '';
		return raw.startsWith('##') ? raw.slice(2) : raw;
	}

	/**
	 * Faithful to transformers.js: a single-token decode returns the raw
	 * vocab entry unchanged, `##` prefix included.
	 */
	function decodeToken(id: number): string {
		return vocab[id] ?? '';
	}

	/**
	 * Whole-sequence decode (WordPiece style): the first token is emitted
	 * raw; every later token strips `##` if it is a continuation and is
	 * joined with a space otherwise.
	 */
	function decodeAll(ids: readonly number[]): string {
		let text = '';
		let first = true;
		for (const id of ids) {
			if (id === MASK) continue;
			const raw = vocab[id] ?? '';
			if (first) {
				text += raw;
			} else if (raw.startsWith('##')) {
				text += raw.slice(2);
			} else {
				text += ' ' + raw;
			}
			first = false;
		}
		return text;
	}

	it('aligns spans to the whole-sequence decode', () => {
		const ids = new Int32Array([0, 1, 2]);
		const recency = new Float32Array([0, 0, 1]);
		const text = decodeAll([0, 1, 2]);
		const spans = allTokenCharSpans(ids, recency, decodeToken, MASK, text);
		expect(text).toBe('playing dog');
		expect(spans).toHaveLength(3);
		for (const s of spans) {
			expect(text.slice(s.start, s.end)).toBe(pieceText(s.tokenId));
		}
		expect(spans[0]).toMatchObject({ start: 0, end: 4 });
		expect(spans[1]).toMatchObject({ start: 4, end: 7 });
		expect(spans[2]).toMatchObject({ start: 8, end: 11 });
	});

	it('skips mask sentinels without shifting later spans', () => {
		const ids = new Int32Array([0, MASK, 2]);
		const recency = new Float32Array([0, 0, 0]);
		const text = decodeAll([0, MASK, 2]);
		const spans = allTokenCharSpans(ids, recency, decodeToken, MASK, text);
		expect(text).toBe('play dog');
		expect(spans).toHaveLength(2);
		for (const s of spans) {
			expect(text.slice(s.start, s.end)).toBe(pieceText(s.tokenId));
		}
		expect(spans[0]).toMatchObject({ start: 0, end: 4 });
		expect(spans[1]).toMatchObject({ start: 5, end: 8 });
	});

	it('maps recency and index to the original token positions', () => {
		const ids = new Int32Array([0, MASK, 1, 2]);
		const recency = new Float32Array([0.5, 0, 1, 0]);
		const text = decodeAll([0, MASK, 1, 2]);
		const spans = allTokenCharSpans(ids, recency, decodeToken, MASK, text);
		expect(spans).toHaveLength(3);
		expect(spans[0]).toMatchObject({ tokenId: 0, index: 0, recency: 0.5 });
		expect(spans[1]).toMatchObject({ tokenId: 1, index: 2, recency: 1 });
		expect(spans[2]).toMatchObject({ tokenId: 2, index: 3, recency: 0 });
	});

	it('aligns continuation pieces of a multi-piece word (## regression)', () => {
		// Isolated decodes keep `##`: 'h', '##yp', '##hen', '##ated'.
		const word = ['h', '##yp', '##hen', '##ated'];
		const decodeToken = (id: number): string => word[id] ?? '';
		const decodeWord = (ids: readonly number[]): string => {
			let text = '';
			let first = true;
			for (const id of ids) {
				const raw = word[id] ?? '';
				if (first) {
					text += raw;
				} else if (raw.startsWith('##')) {
					text += raw.slice(2);
				} else {
					text += ' ' + raw;
				}
				first = false;
			}
			return text;
		};

		const ids = new Int32Array([0, 1, 2, 3]);
		const recency = new Float32Array(4);
		const text = decodeWord([0, 1, 2, 3]);
		expect(text).toBe('hyphenated');

		const spans = allTokenCharSpans(ids, recency, decodeToken, 99, text);
		expect(spans.map((s) => text.slice(s.start, s.end))).toEqual(['h', 'yp', 'hen', 'ated']);
		expect(spans.map((s) => [s.start, s.end])).toEqual([
			[0, 1],
			[1, 3],
			[3, 6],
			[6, 10],
		]);
		expect(spans.map((s) => s.index)).toEqual([0, 1, 2, 3]);
	});

	it('aligns two multi-piece words without dropping continuations', () => {
		const word = ['h', '##yp', '##hen', '##ated'];
		const decodeToken = (id: number): string => word[id] ?? '';
		// Same WordPiece-style whole-sequence decode as above.
		const decodeWords = (ids: Int32Array): string => {
			let text = '';
			let first = true;
			for (const id of ids) {
				const raw = word[id] ?? '';
				if (first) {
					text += raw;
				} else if (raw.startsWith('##')) {
					text += raw.slice(2);
				} else {
					text += ' ' + raw;
				}
				first = false;
			}
			return text;
		};

		const ids = new Int32Array([0, 1, 2, 3, 0, 1, 2]);
		const recency = new Float32Array(7);
		const text = decodeWords(ids);
		expect(text).toBe('hyphenated hyphen');

		const spans = allTokenCharSpans(ids, recency, decodeToken, 99, text);
		expect(spans.map((s) => text.slice(s.start, s.end))).toEqual([
			'h',
			'yp',
			'hen',
			'ated',
			'h',
			'yp',
			'hen',
		]);
		expect(spans.map((s) => [s.start, s.end])).toEqual([
			[0, 1],
			[1, 3],
			[3, 6],
			[6, 10],
			[11, 12],
			[12, 14],
			[14, 17],
		]);
		// The final token's span reaches the end of the decoded prose.
		expect(spans[spans.length - 1]!.end).toBe(text.length);
	});
});
describe('alignTokenPieces (differential vs naive prefix-length reference)', () => {
	/**
	 * Stub whole-sequence decode with cleanup disabled: strips `##` and
	 * joins non-`##` pieces with a single space. Empty pieces emit nothing
	 * and no separator. Prefix decoding is prefix-consistent because there
	 * is no cleanup.
	 */
	function decodeStub(rawTokens: readonly string[]): string {
		let text = '';
		let first = true;
		for (const raw of rawTokens) {
			if (raw === '') {
				first = false;
				continue;
			}
			const isCont = raw.startsWith('##');
			if (!first && !isCont) text += ' ';
			text += isCont ? raw.slice(2) : raw;
			first = false;
		}
		return text;
	}

	/**
	 * Naive reference: decode the prefix of the first $k$ pieces and measure
	 * its length, then add one for each non-`##` piece after the first.
	 * Empty pieces sit at the cursor: they emit no separator, so their span
	 * is the prefix length with no +1.
	 */
	function naiveSpans(rawTokens: readonly string[]): { start: number; end: number }[] {
		const spans: { start: number; end: number }[] = [];
		for (let k = 0; k < rawTokens.length; k++) {
			const raw = rawTokens[k]!;
			const isCont = raw.startsWith('##');
			const pieceText = isCont ? raw.slice(2) : raw;
			const prefix = decodeStub(rawTokens.slice(0, k));
			let start = prefix.length;
			if (k > 0 && !isCont && pieceText.length > 0) start += 1;
			spans.push({ start, end: start + pieceText.length });
		}
		return spans;
	}

	const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

	/** Random word; occasionally returns '' (an empty piece). */
	function randomWord(prng: () => number): string {
		if (prng() < 0.05) return '';
		const len = 1 + Math.floor(prng() * 5);
		let s = '';
		for (let i = 0; i < len; i++) {
			s += LETTERS[Math.floor(prng() * LETTERS.length)];
		}
		return s;
	}

	it('matches the naive reference on random WordPiece sequences', () => {
		const prng = seedrandom.alea('align-token-spans' + '\0');
		const CASES = 200;

		for (let c = 0; c < CASES; c++) {
			const rawTokens: string[] = [];
			const numTokens = 3 + Math.floor(prng() * 8);
			for (let i = 0; i < numTokens; i++) {
				const w = randomWord(prng);
				const isCont = w.length > 0 && rawTokens.length > 0 && prng() < 0.4;
				rawTokens.push(isCont ? '##' + w : w);
			}

			const text = decodeStub(rawTokens);
			const pieces: TokenPiece[] = rawTokens.map((raw, i) => ({
				index: i,
				tokenId: i,
				text: raw.startsWith('##') ? raw.slice(2) : raw,
			}));

			const actual = alignTokenPieces(text, pieces);
			const expected = naiveSpans(rawTokens);
			expect(
				actual,
				`case ${c}: text=${JSON.stringify(text)} raw=${JSON.stringify(rawTokens)}`,
			).toEqual(expected);
		}
	});

	it('matches the naive reference with mask sentinels interspersed', () => {
		const prng = seedrandom.alea('align-token-spans-masks' + '\0');
		const CASES = 200;

		for (let c = 0; c < CASES; c++) {
			const rawTokens: string[] = [];
			const isMask: boolean[] = [];
			const numTokens = 3 + Math.floor(prng() * 8);
			for (let i = 0; i < numTokens; i++) {
				if (prng() < 0.15) {
					isMask.push(true);
					rawTokens.push('');
				} else {
					let w = randomWord(prng);
					// An empty piece never immediately follows a mask sentinel.
					if (w === '' && isMask[isMask.length - 1]) w = randomWord(prng) || 'a';
					const isCont =
						w.length > 0 && rawTokens.length > 0 && !isMask[rawTokens.length - 1] && prng() < 0.4;
					rawTokens.push(isCont ? '##' + w : w);
					isMask.push(false);
				}
			}

			const visible = rawTokens.filter((_, i) => !isMask[i]!);
			const text = decodeStub(visible);
			const pieces: TokenPiece[] = visible.map((raw, i) => ({
				index: i,
				tokenId: i,
				text: raw.startsWith('##') ? raw.slice(2) : raw,
			}));

			const actual = alignTokenPieces(text, pieces);
			const expected = naiveSpans(visible);
			expect(
				actual,
				`case ${c}: text=${JSON.stringify(text)} raw=${JSON.stringify(rawTokens)}`,
			).toEqual(expected);
		}
	});
});
