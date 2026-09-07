import { describe, it, expect } from 'vitest';
import { CharOverlapModel } from './char-overlap-model.js';

describe('CharOverlapModel', () => {
	const vocab = ['cat', 'cats', 'car', 'cart', 'dog', 'dogs', 'frog', 'log', 'a', ''];

	it('has correct K', () => {
		const model = new CharOverlapModel(vocab);
		expect(model.K).toBe(vocab.length);
	});

	it('has id "char-overlap"', () => {
		const model = new CharOverlapModel(vocab);
		expect(model.id).toBe('char-overlap');
	});

	it('distance: identical tokens return 0', () => {
		const model = new CharOverlapModel(vocab);
		expect(model.distance(0, 0, 1)).toBe(0);
	});

	it('distance: "cat" to "cats" — share {c,a,t}, J=3/4=0.75, d=0.25', () => {
		const model = new CharOverlapModel(vocab);
		const d = model.distance(0, 1, 1);
		expect(d).toBeCloseTo(0.25, 5);
	});

	it('distance: "cat" to "car" — share {c,a}, J=2/4=0.5, d=0.5', () => {
		const model = new CharOverlapModel(vocab);
		const d = model.distance(0, 2, 1);
		expect(d).toBeCloseTo(0.5, 5);
	});

	it('distance: "cat" to "dog" — disjoint, d=1', () => {
		const model = new CharOverlapModel(vocab);
		expect(model.distance(0, 4, 1)).toBe(1);
	});

	it('distance: symmetric', () => {
		const model = new CharOverlapModel(vocab);
		expect(model.distance(0, 1, 1)).toBe(model.distance(1, 0, 1));
		expect(model.distance(0, 4, 1)).toBe(model.distance(4, 0, 1));
	});

	it('distance: returns maxDist+1 when exceeds cap', () => {
		const model = new CharOverlapModel(vocab);
		// 'cat' to 'dog' d=1, maxDist=0.5 → should return 1.5.
		expect(model.distance(0, 4, 0.5)).toBe(1.5);
	});

	it('distance: empty string to anything is 1', () => {
		const model = new CharOverlapModel(vocab);
		expect(model.distance(9, 0, 1)).toBe(1); // '' to 'cat'
	});

	it('distance: both empty is 1', () => {
		const model = new CharOverlapModel(vocab);
		expect(model.distance(9, 9, 1)).toBe(0); // self
	});

	it('distance: "dog" to "dogs" — share {d,o,g}, J=3/4=0.75, d=0.25', () => {
		const model = new CharOverlapModel(vocab);
		const d = model.distance(4, 5, 1);
		expect(d).toBeCloseTo(0.25, 5);
	});

	it('distance: "dog" to "frog" — share {o,g}, J=2/5=0.4, d=0.6', () => {
		const model = new CharOverlapModel(vocab);
		const d = model.distance(4, 6, 1);
		expect(d).toBeCloseTo(0.6, 5);
	});

	it('distance: "dog" to "log" — share {o,g}, J=2/4=0.5, d=0.5', () => {
		const model = new CharOverlapModel(vocab);
		const d = model.distance(4, 7, 1);
		expect(d).toBeCloseTo(0.5, 5);
	});

	it('candidates: finds tokens sharing characters', () => {
		const model = new CharOverlapModel(vocab);
		const cands = [...model.candidates(0, 0.9)]; // 'cat'
		// Should include 'cats', 'car', 'cart' (share chars with 'cat').
		expect(cands).toContain(1); // cats
		expect(cands).toContain(2); // car
		expect(cands).toContain(3); // cart
		// Should NOT include 'dog', 'dogs', 'frog', 'log' (no shared chars).
		expect(cands).not.toContain(4);
		expect(cands).not.toContain(5);
		expect(cands).not.toContain(6);
		expect(cands).not.toContain(7);
	});

	it('candidates: no false exclusions (soundness)', () => {
		const model = new CharOverlapModel(vocab);
		// For every token, every true neighbor within radius 0.9 must appear
		// in candidates.
		for (let i = 0; i < vocab.length; i++) {
			const cands = new Set(model.candidates(i, 0.9));
			for (let j = 0; j < vocab.length; j++) {
				if (i === j) continue;
				const d = model.distance(i, j, 0.9);
				if (d <= 0.9) {
					expect(cands.has(j)).toBe(true);
				}
			}
		}
	});

	it('candidates: empty-string token has no candidates', () => {
		const model = new CharOverlapModel(vocab);
		const cands = [...model.candidates(9, 0.9)];
		expect(cands.length).toBe(0);
	});

	it('candidates: radius >= 1 returns all other tokens', () => {
		const model = new CharOverlapModel(vocab);
		const cands = [...model.candidates(0, 1.0)];
		expect(cands.length).toBe(vocab.length - 1);
	});

	it('distance: handles Unicode characters', () => {
		const model = new CharOverlapModel(['café', 'cafe', 'naïve', 'naive']);
		// 'café' vs 'cafe': share {c,a,f}, J=3/5=0.6, d=0.4.
		expect(model.distance(0, 1, 1)).toBeCloseTo(0.4, 5);
		// 'naïve' vs 'naive': share {n,a,v,e} (ï≠i), J=4/6≈0.667, d≈0.333.
		expect(model.distance(2, 3, 1)).toBeCloseTo(1 / 3, 5);
	});
});

describe('CharOverlapModel (multiset mode)', () => {
	const vocab = ['dog', 'god', 'doggo', 'dogg', 'cat', ''];

	it('has id "char-overlap-multiset"', () => {
		const model = new CharOverlapModel(vocab, 'multiset');
		expect(model.id).toBe('char-overlap-multiset');
	});

	it('has mode "multiset"', () => {
		const model = new CharOverlapModel(vocab, 'multiset');
		expect(model.mode).toBe('multiset');
	});

	it('distance: "dog" to "god" — same multiset, d=0', () => {
		const model = new CharOverlapModel(vocab, 'multiset');
		expect(model.distance(0, 1, 1)).toBe(0);
	});

	it('distance: "dog" to "doggo" — min={d:1,o:1,g:1}=3, max={d:1,o:2,g:2}=5, J=3/5, d=0.4', () => {
		const model = new CharOverlapModel(vocab, 'multiset');
		const d = model.distance(0, 2, 1);
		expect(d).toBeCloseTo(0.4, 5);
	});

	it('distance: "dog" to "dogg" — min={d:1,o:1,g:1}=3, max={d:1,o:1,g:2}=4, J=3/4, d=0.25', () => {
		const model = new CharOverlapModel(vocab, 'multiset');
		const d = model.distance(0, 3, 1);
		expect(d).toBeCloseTo(0.25, 5);
	});

	it('distance: "doggo" to "dogg" — min={d:1,o:1,g:2}=4, max={d:1,o:2,g:2}=5, J=4/5, d=0.2', () => {
		const model = new CharOverlapModel(vocab, 'multiset');
		const d = model.distance(2, 3, 1);
		expect(d).toBeCloseTo(0.2, 5);
	});

	it('distance: "dog" to "cat" — disjoint, d=1', () => {
		const model = new CharOverlapModel(vocab, 'multiset');
		expect(model.distance(0, 4, 1)).toBe(1);
	});

	it('distance: symmetric', () => {
		const model = new CharOverlapModel(vocab, 'multiset');
		expect(model.distance(0, 2, 1)).toBe(model.distance(2, 0, 1));
	});

	it('distance: identical tokens return 0', () => {
		const model = new CharOverlapModel(vocab, 'multiset');
		expect(model.distance(0, 0, 1)).toBe(0);
	});

	it('distance: returns maxDist+1 when exceeds cap', () => {
		const model = new CharOverlapModel(vocab, 'multiset');
		// 'dog' to 'doggo' d=0.4, maxDist=0.3 → should return 1.3.
		expect(model.distance(0, 2, 0.3)).toBe(1.3);
	});

	it('distance: empty string to anything is 1', () => {
		const model = new CharOverlapModel(vocab, 'multiset');
		expect(model.distance(5, 0, 1)).toBe(1);
	});

	it('candidates: soundness holds for multiset mode', () => {
		const model = new CharOverlapModel(vocab, 'multiset');
		for (let i = 0; i < vocab.length; i++) {
			const cands = new Set(model.candidates(i, 0.9));
			for (let j = 0; j < vocab.length; j++) {
				if (i === j) continue;
				const d = model.distance(i, j, 0.9);
				if (d <= 0.9) {
					expect(cands.has(j)).toBe(true);
				}
			}
		}
	});
});
