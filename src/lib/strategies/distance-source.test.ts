import { describe, it, expect } from 'vitest';
import { EditDistanceModel } from './distance-model.js';
import { CharOverlapModel } from './char-overlap-model.js';
import { NeighborhoodProvider } from './neighborhood.js';
import { ModelDistanceSource } from './distance-source.js';

// Vocab with known edit distances from 'cat' (id 0):
// 'cats' d=1, 'car' d=1, 'cart' d=2, 'dog' d=3.
const vocab = ['cat', 'cats', 'car', 'cart', 'dog'];

function makeSource(): { source: ModelDistanceSource; provider: NeighborhoodProvider } {
	const model = new EditDistanceModel(vocab);
	const provider = new NeighborhoodProvider(model, 3);
	return { source: new ModelDistanceSource(model, provider), provider };
}

describe('ModelDistanceSource', () => {
	it('topK returns ascending distances, self excluded', () => {
		const { source } = makeSource();
		// The bigram candidate index never yields 'dog' (no shared bigram
		// with 'cat'), so the table holds ids 1, 2, 3 only.
		const table = source.topK(0, 10, 3);
		expect(Array.from(table.ids)).toEqual([1, 2, 3]);
		const dists = Array.from(table.dists);
		for (let i = 1; i < dists.length; i++) {
			expect(dists[i]!).toBeGreaterThanOrEqual(dists[i - 1]!);
		}
		expect(table.ids.includes(0)).toBe(false);
	});

	it('topK respects k', () => {
		const { source } = makeSource();
		const table = source.topK(0, 2, 3);
		expect(Array.from(table.ids)).toEqual([1, 2]);
	});

	it('topK respects maxDistance', () => {
		const { source } = makeSource();
		// From 'car' (id 2): 'cat' d=1, 'cart' d=1, 'cats' d=2.
		// maxDistance 1 keeps only 'cat' and 'cart'.
		const table = source.topK(2, 10, 1);
		expect(Array.from(table.ids)).toEqual([0, 3]);
	});

	it('topK returns empty arrays when nothing passes the filter', () => {
		const { source } = makeSource();
		const table = source.topK(0, 10, 0);
		expect(table.ids.length).toBe(0);
		expect(table.dists.length).toBe(0);
	});

	it('id and params are stable across tau / family / epsilon changes', () => {
		// The cache identity is (id, params); kernel read-time params must
		// not appear here. The source has no constructor inputs for them,
		// so consecutive constructions must produce identical identity.
		const a = makeSource().source;
		const b = makeSource().source;
		expect(a.id).toBe(b.id);
		expect(a.params).toEqual(b.params);
	});

	it('params record the radius ceiling and store limit', () => {
		const model = new EditDistanceModel(vocab);
		const provider = new NeighborhoodProvider(model, 3, { maxStored: 200 });
		const source = new ModelDistanceSource(model, provider, { maxStored: 200 });
		expect(source.params).toEqual({ rMax: 3, maxStored: 200 });
	});

	it('params.maxStored defaults to the provider cap on the real path', () => {
		const model = new EditDistanceModel(vocab);
		const provider = new NeighborhoodProvider(model, 3, { maxStored: 200 });
		const source = new ModelDistanceSource(model, provider);
		expect(provider.maxStored).toBe(200);
		expect(source.params.maxStored).toBe(provider.maxStored);
	});

	it('params.maxStored is null when the provider is unbounded', () => {
		const { source } = makeSource();
		expect(source.params.maxStored).toBeNull();
	});

	it('vocabSize mirrors the model', () => {
		const { source } = makeSource();
		expect(source.vocabSize).toBe(vocab.length);
	});

	it('distance delegates to the model, capped at the radius ceiling', () => {
		const { source, provider } = makeSource();
		expect(source.distance(0, 1)).toBe(1);
		expect(source.distance(0, 0)).toBe(0);
		// 'cat' -> 'dog' is d=3, within R_MAX=3.
		expect(source.distance(0, 4)).toBe(3);
		expect(provider.R_MAX).toBe(3);
	});

	it('works over the char-overlap model', () => {
		const model = new CharOverlapModel(['cat', 'cats', 'car', 'xyz'], 'set');
		const provider = new NeighborhoodProvider(model, 1.0);
		const source = new ModelDistanceSource(model, provider);
		expect(source.id).toBe('char-overlap');
		const table = source.topK(0, 10, 0.5);
		// 'cats' d=0.25, 'car' d=0.5; 'xyz' shares no chars (d=1 > 0.5).
		expect(Array.from(table.ids)).toEqual([1, 2]);
	});
});
