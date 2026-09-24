import { describe, it, expect } from 'vitest';
import { buildNeighborGraph } from './neighbor-graph.js';
import { NeighborhoodProvider } from './neighborhood.js';
import type { DistanceModel } from './distance-model.js';

/**
 * A tiny synthetic distance model: token id `i` is the string
 * `String.fromCharCode(97 + i)` repeated `i + 1` times, so edit distance
 * between ids $a < b$ is $b - a$ (append-only). $K = 6$.
 */
class SyntheticModel implements DistanceModel {
	readonly id = 'synthetic';
	readonly K = 6;

	candidates(token: number, _radius: number): Iterable<number> {
		const out: number[] = [];
		for (let j = 0; j < this.K; j++) if (j !== token) out.push(j);
		return out;
	}

	distance(a: number, b: number, maxDist: number): number {
		const d = Math.abs(a - b);
		return d <= maxDist ? d : maxDist + 1;
	}
}

function makeProvider(): NeighborhoodProvider {
	return new NeighborhoodProvider(new SyntheticModel(), 3);
}

const params = { maxDistance: 3, k: 50, tau: 1.0 };
const labelOf = (id: number) => `t${id}`;

describe('buildNeighborGraph', () => {
	it('returns null when center has no neighbors in range', () => {
		// maxDistance 0 → no neighbor passes the filter.
		const g = buildNeighborGraph(
			makeProvider(),
			0,
			{ ...params, maxDistance: 0 },
			{ limitMode: 'top-k', k: 5, p: 0.95 },
			labelOf,
		);
		expect(g).toBeNull();
	});

	it('includes center node at hop 0', () => {
		const g = buildNeighborGraph(
			makeProvider(),
			0,
			params,
			{ limitMode: 'top-k', k: 5, p: 0.95 },
			labelOf,
		);
		expect(g).not.toBeNull();
		const center = g!.nodes.find((n) => n.hop === 0);
		expect(center).toBeDefined();
		expect(center!.id).toBe(0);
		expect(center!.label).toBe('t0');
	});

	it('produces hop-1 and hop-2 nodes with edges', () => {
		const g = buildNeighborGraph(
			makeProvider(),
			0,
			params,
			{ limitMode: 'top-k', k: 5, p: 0.95 },
			labelOf,
		);
		expect(g).not.toBeNull();
		const hop1 = g!.nodes.filter((n) => n.hop === 1);
		const hop2 = g!.nodes.filter((n) => n.hop === 2);
		expect(hop1.length).toBeGreaterThan(0);
		expect(hop2.length).toBeGreaterThan(0);
		// Every edge from the center targets a hop-1 node.
		for (const e of g!.edges.filter((e) => e.from === 0)) {
			const target = g!.nodes.find((n) => n.id === e.to);
			expect(target?.hop).toBe(1);
		}
	});

	it('edge weights are positive and per-node out-sums do not exceed 1', () => {
		const g = buildNeighborGraph(
			makeProvider(),
			0,
			params,
			{ limitMode: 'top-k', k: 5, p: 0.95 },
			labelOf,
		);
		expect(g).not.toBeNull();
		const byFrom = new Map<number, number>();
		for (const e of g!.edges) {
			expect(e.weight).toBeGreaterThan(0);
			expect(e.weight).toBeLessThanOrEqual(1);
			byFrom.set(e.from, (byFrom.get(e.from) ?? 0) + e.weight);
		}
		for (const sum of byFrom.values()) {
			// May be < 1 when the edge back to the center is skipped.
			expect(sum).toBeLessThanOrEqual(1 + 1e-5);
		}
	});

	it('top-k limits hop-1 spread', () => {
		const g = buildNeighborGraph(
			makeProvider(),
			0,
			params,
			{ limitMode: 'top-k', k: 2, p: 0.95 },
			labelOf,
		);
		expect(g).not.toBeNull();
		const hop1 = g!.nodes.filter((n) => n.hop === 1);
		expect(hop1.length).toBe(2);
	});

	it('top-p limits hop-1 spread', () => {
		const g = buildNeighborGraph(
			makeProvider(),
			0,
			params,
			{ limitMode: 'top-p', k: 50, p: 0.6 },
			labelOf,
		);
		expect(g).not.toBeNull();
		const hop1 = g!.nodes.filter((n) => n.hop === 1);
		expect(hop1.length).toBeLessThan(3);
		expect(hop1.length).toBeGreaterThanOrEqual(1);
	});

	it('closer neighbors get thicker (higher-weight) edges', () => {
		const g = buildNeighborGraph(
			makeProvider(),
			0,
			params,
			{ limitMode: 'top-k', k: 5, p: 0.95 },
			labelOf,
		);
		expect(g).not.toBeNull();
		const centerEdges = g!.edges.filter((e) => e.from === 0);
		// Entries are distance-sorted, so weight should be non-increasing.
		for (let i = 1; i < centerEdges.length; i++) {
			expect(centerEdges[i - 1]!.weight).toBeGreaterThanOrEqual(centerEdges[i]!.weight);
		}
	});

	it('never re-adds the center as a hop-2 node', () => {
		const g = buildNeighborGraph(
			makeProvider(),
			0,
			params,
			{ limitMode: 'top-k', k: 5, p: 0.95 },
			labelOf,
		);
		expect(g).not.toBeNull();
		const centerNodes = g!.nodes.filter((n) => n.id === 0);
		expect(centerNodes.length).toBe(1);
	});

	it('caps nodes per hop for legibility', () => {
		const g = buildNeighborGraph(
			makeProvider(),
			0,
			params,
			{ limitMode: 'top-k', k: 5, p: 0.95, maxPerHop: 2 },
			labelOf,
		);
		expect(g).not.toBeNull();
		const hop1 = g!.nodes.filter((n) => n.hop === 1);
		expect(hop1.length).toBe(2);
		// The kept nodes should be the heaviest (closest) ones.
		expect(hop1.map((n) => n.id)).toEqual([1, 2]);
	});

	it('deduplicates nodes shared between hops', () => {
		const g = buildNeighborGraph(
			makeProvider(),
			0,
			params,
			{ limitMode: 'top-k', k: 5, p: 0.95 },
			labelOf,
		);
		expect(g).not.toBeNull();
		const ids = g!.nodes.map((n) => n.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});
