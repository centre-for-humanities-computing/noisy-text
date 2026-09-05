import { describe, it, expect } from 'vitest';
import {
	levenshtein,
	EditDistanceModel,
} from './distance-model.js';

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
		expect(levenshtein('a', 'abcdef', 2)).toBe(3);
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
		expect(levenshtein('abc', 'bcd', 2)).toBe(2);
	});

	it('swaps args internally for optimal DP order', () => {
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

describe('EditDistanceModel', () => {
	const vocab = ['cat', 'cats', 'car', 'cart', 'dog', 'dogs', 'frog', 'log'];

	it('has correct K', () => {
		const model = new EditDistanceModel(vocab);
		expect(model.K).toBe(vocab.length);
	});

	it('has id "edit-distance"', () => {
		const model = new EditDistanceModel(vocab);
		expect(model.id).toBe('edit-distance');
	});

	it('distance: identical tokens return 0', () => {
		const model = new EditDistanceModel(vocab);
		expect(model.distance(0, 0, 5)).toBe(0);
	});

	it('distance: "cat" to "cats" is 1', () => {
		const model = new EditDistanceModel(vocab);
		expect(model.distance(0, 1, 5)).toBe(1);
	});

	it('distance: symmetric', () => {
		const model = new EditDistanceModel(vocab);
		expect(model.distance(0, 1, 5)).toBe(model.distance(1, 0, 5));
	});

	it('distance: returns maxDist+1 when exceeds cap', () => {
		const model = new EditDistanceModel(vocab);
		// 'cat' to 'dog' is 3 edits.
		expect(model.distance(0, 4, 1)).toBe(2);
	});

	it('candidates: finds "cats" and "car" for "cat" within radius 1', () => {
		const model = new EditDistanceModel(vocab);
		const cands = [...model.candidates(0, 1)];
		expect(cands).toContain(1); // cats
		expect(cands).toContain(2); // car
	});

	it('candidates: no false exclusions (soundness)', () => {
		const model = new EditDistanceModel(vocab);
		// For every token, every true neighbor within radius 1 must appear
		// in candidates.
		for (let i = 0; i < vocab.length; i++) {
			const cands = new Set(model.candidates(i, 1));
			for (let j = 0; j < vocab.length; j++) {
				if (i === j) continue;
				const d = model.distance(i, j, 1);
				if (d <= 1) {
					expect(cands.has(j)).toBe(true);
				}
			}
		}
	});

	it('candidates: handles zero-bigram tokens', () => {
		// Single-character tokens have no bigrams.
		const model = new EditDistanceModel(['a', 'b', 'ab']);
		const cands = [...model.candidates(0, 1)];
		expect(cands).toContain(1); // 'b' is d=1 from 'a'
	});
});