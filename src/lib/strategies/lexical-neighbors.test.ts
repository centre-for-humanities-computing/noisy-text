import { describe, it, expect } from 'vitest';
import {
	normalizeTokenString,
	levenshtein,
	computeNeighborTable,
} from './lexical-neighbors.js';
import type { LexicalNeighborParams } from './lexical-neighbors.js';

describe('normalizeTokenString', () => {
	it('preserves normal strings', () => {
		expect(normalizeTokenString('hello')).toBe('hello');
	});

	it('strips BERT continuation marker ##', () => {
		expect(normalizeTokenString('##ing')).toBe('ing');
	});

	it('converts GPT-2 Ġ marker to space then strips leading space', () => {
		expect(normalizeTokenString('Ġhello')).toBe('hello');
	});

	it('handles Ġ followed by more text', () => {
		// 'Ġ ' is space + space after conversion, trimStart leaves empty.
		expect(normalizeTokenString('Ġ ')).toBe('');
	});

	it('handles pure Ġ marker (space token)', () => {
		// Ā is not Ġ, this is a single space-after-normalization case.
		// Actually: 'Ġ' alone → ' ', trimStart → ''.
		expect(normalizeTokenString('Ġ')).toBe('');
	});

	it('handles ## inside word (non-leading)', () => {
		expect(normalizeTokenString('ab##c')).toBe('ab##c');
	});

	it('applies NFC normalization', () => {
		// é as composed (NFC) vs decomposed (NFD).
		const composed = '\u00E9'; // é NFC
		const decomposed = 'e\u0301'; // é NFD
		expect(normalizeTokenString(decomposed)).toBe(composed);
	});
});

describe('levenshtein', () => {
	it('returns 0 for identical strings', () => {
		expect(levenshtein('hello', 'hello', 5)).toBe(0);
	});

	it('returns 1 for single substitution', () => {
		expect(levenshtein('hello', 'hallo', 5)).toBe(1);
	});

	it('returns 1 for single insertion', () => {
		expect(levenshtein('cat', 'cats', 5)).toBe(1);
	});

	it('returns 1 for single deletion', () => {
		expect(levenshtein('cats', 'cat', 5)).toBe(1);
	});

	it('returns correct distance for multi-edit', () => {
		expect(levenshtein('kitten', 'sitting', 10)).toBe(3);
	});

	it('returns maxDist+1 when distance exceeds cap', () => {
		expect(levenshtein('hello', 'world', 1)).toBe(2);
	});

	it('early-exits on length difference alone', () => {
		// |'a'|=1, |'abcdef'|=6, diff=5 > maxDist=2 → returns maxDist+1.
		expect(levenshtein('a', 'abcdef', 2)).toBe(3);
		// |'a'|=1, |'abcde'|=5, diff=4 > maxDist=3 → returns maxDist+1.
		expect(levenshtein('a', 'abcde', 3)).toBe(4);
	});

	it('handles empty string', () => {
		expect(levenshtein('', 'abc', 5)).toBe(3);
		expect(levenshtein('abc', '', 5)).toBe(3);
	});

	it('handles both empty', () => {
		expect(levenshtein('', '', 5)).toBe(0);
	});

	it('returns exact distance when within cap', () => {
		// 'abc' → 'bcd' = 2 (sub a→b, b→c, leave c→d)
		expect(levenshtein('abc', 'bcd', 2)).toBe(2);
	});

	it('swaps args internally for optimal DP order', () => {
		// Long first arg, short second — should still be correct.
		const long = 'abcdefghij';
		const short = 'xyz';
		expect(levenshtein(long, short, 10)).toBe(levenshtein(short, long, 10));
	});

	it('handles Unicode characters', () => {
		expect(levenshtein('café', 'cafe', 5)).toBe(1);
	});

	it('returns maxDist+1 for completely dissimilar strings', () => {
		expect(levenshtein('hello', 'world', 0)).toBe(1);
	});
});

describe('computeNeighborTable', () => {
	const smallVocab = ['cat', 'cats', 'car', 'cart', 'dog', 'dogs', 'frog', 'log'];

	const defaultParams: LexicalNeighborParams = {
		maxDistance: 1,
		k: 5,
		tau: 1.0,
	};

	it('returns correct K', () => {
		const table = computeNeighborTable(smallVocab, defaultParams);
		expect(table.K).toBe(smallVocab.length);
	});

	it('offsets has length K+1', () => {
		const table = computeNeighborTable(smallVocab, defaultParams);
		expect(table.offsets.length).toBe(smallVocab.length + 1);
	});

	it('neighborIds and weights have same length', () => {
		const table = computeNeighborTable(smallVocab, defaultParams);
		expect(table.neighborIds.length).toBe(table.weights.length);
	});

	it('offsets are nondecreasing', () => {
		const table = computeNeighborTable(smallVocab, defaultParams);
		for (let i = 0; i < smallVocab.length; i++) {
			expect(table.offsets[i]! <= table.offsets[i + 1]!).toBe(true);
		}
	});

	it('last offset equals total neighbor count', () => {
		const table = computeNeighborTable(smallVocab, defaultParams);
		expect(table.offsets[smallVocab.length]).toBe(table.neighborIds.length);
	});

	it('finds neighbors for "cat" within distance 1', () => {
		// 'cat' within d=1 of: 'cats' (1 ins), 'car' (1 sub).
		// Index: cat=0, cats=1, car=2, cart=3, dog=4, dogs=5, frog=6, log=7
		const table = computeNeighborTable(smallVocab, defaultParams);
		const start = table.offsets[0]!;
		const end = table.offsets[1]!;
		const neighbors = Array.from(table.neighborIds.slice(start, end));
		expect(neighbors).toContain(1); // cats
		expect(neighbors).toContain(2); // car
	});

	it('weights for non-empty neighbor list sum to 1', () => {
		const table = computeNeighborTable(smallVocab, defaultParams);
		for (let i = 0; i < smallVocab.length; i++) {
			const start = table.offsets[i]!;
			const end = table.offsets[i + 1]!;
			if (start < end) {
				let sum = 0;
				for (let j = start; j < end; j++) sum += table.weights[j]!;
				expect(Math.abs(sum - 1)).toBeLessThan(1e-6);
			}
		}
	});

	it('closer neighbors have higher weights', () => {
		// Use a vocab where distances are clearly different.
		// 'a' → 'ab' (d=1), 'a' → 'abc' (d=2).
		const vocab = ['a', 'ab', 'abc', 'b'];
		const table = computeNeighborTable(vocab, { maxDistance: 2, k: 5, tau: 1.0 });
		// Check token 0 ('a').
		const start = table.offsets[0]!;
		const end = table.offsets[1]!;
		const pairs: { id: number; weight: number }[] = [];
		for (let j = start; j < end; j++) {
			pairs.push({ id: table.neighborIds[j]!, weight: table.weights[j]! });
		}
		// 'ab' (id=1) should have higher weight than 'abc' (id=2) since d=1 < d=2.
		const abIdx = pairs.findIndex((p) => p.id === 1);
		const abcIdx = pairs.findIndex((p) => p.id === 2);
		expect(abIdx).not.toBe(-1);
		expect(abcIdx).not.toBe(-1);
		expect(pairs[abIdx]!.weight).toBeGreaterThan(pairs[abcIdx]!.weight);
	});

	it('respects k truncation', () => {
		const params: LexicalNeighborParams = { maxDistance: 2, k: 1, tau: 1.0 };
		const table = computeNeighborTable(smallVocab, params);
		for (let i = 0; i < smallVocab.length; i++) {
			const start = table.offsets[i]!;
			const end = table.offsets[i + 1]!;
			expect(end - start).toBeLessThanOrEqual(1);
		}
	});

	it('respects maxDistance (no neighbors for isolated token)', () => {
		// 'frog' (id=6) vs others: 'dog' d=2 (fr→d, og→og=0? no: f→d, r→o, og→og)
		// Actually frog→dog is d=2 (f→d, r→o), 'log' (f→l, r→o) d=2. At maxDistance=1
		// no neighbors.
		const table = computeNeighborTable(smallVocab, defaultParams);
		const start = table.offsets[6]!;
		const end = table.offsets[7]!;
		expect(start).toBe(end);
	});

	it('never lists self as neighbor', () => {
		const table = computeNeighborTable(smallVocab, defaultParams);
		for (let i = 0; i < table.K; i++) {
			const start = table.offsets[i]!;
			const end = table.offsets[i + 1]!;
			for (let j = start; j < end; j++) {
				expect(table.neighborIds[j]).not.toBe(i);
			}
		}
	});

	it('progress callback fires with correct totals', () => {
		const progressCalls: { done: number; total: number }[] = [];
		computeNeighborTable(smallVocab, defaultParams, (done, total) => {
			progressCalls.push({ done, total });
		});
		expect(progressCalls.length).toBeGreaterThan(0);
		const last = progressCalls[progressCalls.length - 1]!;
		expect(last.done).toBe(smallVocab.length);
		expect(last.total).toBe(smallVocab.length);
	});

	it('radius soundness: all found neighbors are truly within maxDistance (small vocab brute check)', () => {
		// For a tiny vocab, brute-force verify that every neighbor in the table
		// truly has edit distance ≤ maxDistance.
		const vocab = ['a', 'ab', 'abc', 'b', 'bc'];
		const params: LexicalNeighborParams = { maxDistance: 2, k: 10, tau: 1.0 };
		const table = computeNeighborTable(vocab, params);

		for (let i = 0; i < table.K; i++) {
			const start = table.offsets[i]!;
			const end = table.offsets[i + 1]!;
			for (let j = start; j < end; j++) {
				const dist = levenshtein(vocab[i]!, vocab[table.neighborIds[j]!]!, params.maxDistance);
				expect(dist).toBeLessThanOrEqual(params.maxDistance);
			}
		}
	});

	it('radius completeness: no in-radius neighbor missed (brute force on tiny vocab)', () => {
		// For a tiny vocab, brute-force verify that every token within
		// maxDistance is in the neighbor list (up to k).
		const vocab = ['a', 'ab', 'abc', 'b', 'bc', 'x'];
		const params: LexicalNeighborParams = { maxDistance: 2, k: 20, tau: 1.0 };
		const table = computeNeighborTable(vocab, params);

		for (let i = 0; i < table.K; i++) {
			const start = table.offsets[i]!;
			const end = table.offsets[i + 1]!;
			const found = new Set<number>();
			for (let j = start; j < end; j++) found.add(table.neighborIds[j]!);

			// Brute-force check every other token.
			for (let j = 0; j < table.K; j++) {
				if (j === i) continue;
				const dist = levenshtein(vocab[i]!, vocab[j]!, params.maxDistance);
				if (dist <= params.maxDistance) {
					expect(found.has(j)).toBe(true);
				}
			}
		}
	});

	it('handles single-token vocab', () => {
		const table = computeNeighborTable(['hello'], defaultParams);
		expect(table.K).toBe(1);
		expect(table.offsets[0]).toBe(0);
		expect(table.offsets[1]).toBe(0);
		expect(table.neighborIds.length).toBe(0);
	});

	it('handles empty strings in vocab', () => {
		const vocab = ['', 'a', 'b', ''];
		const params: LexicalNeighborParams = { maxDistance: 1, k: 5, tau: 1.0 };
		const table = computeNeighborTable(vocab, params);
		// All should produce valid offsets.
		expect(table.offsets.length).toBe(5);
		// Empty strings at distance 1: '' → 'a' (d=1), '' → 'b' (d=1)
		const start = table.offsets[0]!;
		const end = table.offsets[1]!;
		const ids: number[] = [];
		for (let j = start; j < end; j++) ids.push(table.neighborIds[j]!);
		// ids should include 1 ('a') and 2 ('b')
		expect(ids.length).toBeGreaterThanOrEqual(2);
		expect(ids).toContain(1);
		expect(ids).toContain(2);
	});
});