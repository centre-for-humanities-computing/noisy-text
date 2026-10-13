import { describe, it, expect } from 'vitest';
import {
	STRING_DISTANCE_KERNELS,
	getStringDistanceKernel,
	stringDistanceKernelFor,
} from './string-distance-kernel.js';
import { EditDistanceModel } from './distance-model.js';
import { CharOverlapModel } from './char-overlap-model.js';
import type { DistanceModel } from './distance-model.js';

const vocab = ['cat', 'cats', 'car', 'cart', 'dog', 'god', 'doggo'];

/** Max model distance used for comparisons against the string-level pair. */
function maxDistOf(model: DistanceModel): number {
	return model.id === 'edit-distance' ? Math.max(...vocab.map((s) => s.length)) : 1;
}

describe('string distance kernels', () => {
	it('exposes exactly the three documented kernels', () => {
		expect(Object.keys(STRING_DISTANCE_KERNELS).sort()).toEqual([
			'char-overlap-multiset',
			'char-overlap-set',
			'edit-distance',
		]);
	});

	it.each(['edit-distance', 'char-overlap-set', 'char-overlap-multiset'] as const)(
		'%s: distanceFn matches the model distance over a small vocab',
		(id) => {
			const kernel = STRING_DISTANCE_KERNELS[id]!;
			const model = kernel.makeModel(vocab);
			const maxDist = maxDistOf(model);
			for (let a = 0; a < vocab.length; a++) {
				for (let b = 0; b < vocab.length; b++) {
					const fromStrings = kernel.distanceFn(vocab[a]!, vocab[b]!);
					const fromModel = model.distance(a, b, maxDist);
					expect(fromStrings).toBeCloseTo(fromModel, 9);
				}
			}
		},
	);

	it.each(['edit-distance', 'char-overlap-set', 'char-overlap-multiset'] as const)(
		'%s: distanceFn is symmetric with zero self-distance',
		(id) => {
			const { distanceFn } = STRING_DISTANCE_KERNELS[id]!;
			for (const a of vocab) {
				expect(distanceFn(a, a)).toBe(0);
				for (const b of vocab) {
					expect(distanceFn(a, b)).toBeCloseTo(distanceFn(b, a), 12);
				}
			}
		},
	);

	it('edit-distance stringFn is the identity', () => {
		expect(STRING_DISTANCE_KERNELS['edit-distance']!.stringFn('hello')).toBe('hello');
	});

	it('char-overlap-set stringFn yields sorted distinct chars', () => {
		expect(STRING_DISTANCE_KERNELS['char-overlap-set']!.stringFn('banana')).toBe('abn');
	});

	it('char-overlap-multiset stringFn yields the sorted multiset', () => {
		expect(STRING_DISTANCE_KERNELS['char-overlap-multiset']!.stringFn('banana')).toBe('aaabnn');
		// Counts matter: 'dog' vs 'doggo' have multiset distance 0.4.
		expect(
			STRING_DISTANCE_KERNELS['char-overlap-multiset']!.distanceFn('dog', 'doggo'),
		).toBeCloseTo(0.4, 9);
	});

	it.each(['edit-distance', 'char-overlap-set', 'char-overlap-multiset'] as const)(
		'%s: makeModel builds a usable model',
		(id) => {
			const model = STRING_DISTANCE_KERNELS[id]!.makeModel(vocab);
			expect(model.K).toBe(vocab.length);
			// Candidate generation must yield something for a shared-prefix token.
			const candidates = [...model.candidates(0, maxDistOf(model))];
			expect(candidates.length).toBeGreaterThan(0);
			expect(candidates.includes(0)).toBe(false);
		},
	);

	it('makeModel returns the expected concrete models', () => {
		expect(STRING_DISTANCE_KERNELS['edit-distance']!.makeModel(vocab)).toBeInstanceOf(
			EditDistanceModel,
		);
		expect(STRING_DISTANCE_KERNELS['char-overlap-set']!.makeModel(vocab)).toBeInstanceOf(
			CharOverlapModel,
		);
	});
});

describe('getStringDistanceKernel', () => {
	it('returns the kernel for a known id', () => {
		expect(getStringDistanceKernel('edit-distance').id).toBe('edit-distance');
	});

	it('throws on an unknown id', () => {
		expect(() => getStringDistanceKernel('soundex')).toThrow(
			'Unknown string distance kernel "soundex"',
		);
	});
});

describe('stringDistanceKernelFor', () => {
	it("selects the multiset kernel for 'multiset'", () => {
		expect(stringDistanceKernelFor('multiset').id).toBe('char-overlap-multiset');
	});

	it("selects the set kernel for 'set'", () => {
		expect(stringDistanceKernelFor('set').id).toBe('char-overlap-set');
	});

	it('selects the set kernel when the mode is absent', () => {
		expect(stringDistanceKernelFor().id).toBe('char-overlap-set');
	});
});
