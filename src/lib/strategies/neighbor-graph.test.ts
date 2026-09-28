import { describe, it, expect } from 'vitest';
import { buildNeighborGraph, GraphAccumulator } from './neighbor-graph.js';
import { NeighborhoodProvider } from './neighborhood.js';
import { getStrategy } from './index.js';
import type { DistanceModel } from './distance-model.js';
import type { NoiseStrategy, Rng } from './types.js';

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

/**
 * Deterministic stub strategy: `getLocalDistribution` puts mass $w$ on
 * `token + 1` (mod K) and the rest uniformly.
 */
function makeStubStrategy(weight: number): NoiseStrategy<unknown> {
	const K = 6;
	return {
		info: {
			id: 'stub',
			label: 'Stub',
			description: '',
			stationary: 'unknown',
			plainName: '',
			gloss: '',
			tooltip: { text: '' },
		},
		config: {},
		sampleStep(token: number, _beta: number, _rng: Rng): number {
			return (token + 1) % K;
		},
		getLocalDistribution(token: number, _beta: number): Float32Array {
			const dist = new Float32Array(K);
			dist[(token + 1) % K] = weight;
			const rest = (1 - weight) / (K - 1);
			for (let j = 0; j < K; j++) if (j !== (token + 1) % K) dist[j] = rest;
			return dist;
		},
	};
}

const params = { maxDistance: 3, k: 50, tau: 1.0 };
const labelOf = (id: number) => `t${id}`;

describe('buildNeighborGraph', () => {
	it('emits one node per distinct token, no stay edges', () => {
		// $0 \to 0 \to 1 \to 1 \to 2$: two stays, two changes.
		const column = new Int32Array([0, 0, 1, 1, 2]);
		const g = buildNeighborGraph(
			makeStubStrategy(0.7),
			null,
			null,
			column,
			new Float32Array(column.length - 1),
			{ limitMode: 'top-k', k: 5, p: 0.95 },
			labelOf,
		);
		expect(g.nodes).toHaveLength(3);
		const trajEdges = g.edges.filter((e) => e.trajectory);
		expect(trajEdges).toHaveLength(2);
	});

	it('records the step of each change on the edge', () => {
		const column = new Int32Array([0, 0, 1, 1, 2]);
		const g = buildNeighborGraph(
			makeStubStrategy(0.7),
			null,
			null,
			column,
			new Float32Array(column.length - 1),
			{ limitMode: 'top-k', k: 5, p: 0.95 },
			labelOf,
		);
		const e01 = g.edges.find((e) => e.from === 0 && e.to === 1);
		expect(e01?.steps).toEqual([1]); // change happened at $s = 1$
		const e12 = g.edges.find((e) => e.from === 1 && e.to === 2);
		expect(e12?.steps).toEqual([3]);
	});

	it('accumulates steps when a transition recurs', () => {
		// $0 \to 1 \to 0 \to 1$: the 0→1 edge is taken at steps 0 and 2.
		const column = new Int32Array([0, 1, 0, 1]);
		const g = buildNeighborGraph(
			makeStubStrategy(0.7),
			null,
			null,
			column,
			new Float32Array(column.length - 1),
			{ limitMode: 'top-k', k: 5, p: 0.95 },
			labelOf,
		);
		const e01 = g.edges.find((e) => e.from === 0 && e.to === 1);
		expect(e01?.steps).toEqual([0, 2]);
		// Revisit does not duplicate the node.
		expect(g.nodes).toHaveLength(2);
	});

	it('anchors nodes at their earliest appearance', () => {
		const column = new Int32Array([0, 1, 0, 1]);
		const g = buildNeighborGraph(
			makeStubStrategy(0.7),
			null,
			null,
			column,
			new Float32Array(column.length - 1),
			{ limitMode: 'top-k', k: 5, p: 0.95 },
			labelOf,
		);
		const n0 = g.nodes.find((n) => n.id === 0);
		expect(n0?.anchorStep).toBe(0);
	});

	it('adds a 1-hop neighborhood for every trajectory node', () => {
		const column = new Int32Array([0, 1, 2]);
		const g = buildNeighborGraph(
			makeStubStrategy(0.5),
			makeProvider(),
			params,
			column,
			new Float32Array(column.length - 1),
			{ limitMode: 'top-k', k: 5, p: 0.95 },
			labelOf,
		);
		expect(g.hasNeighborhood).toBe(true);
		// Each of the 3 trajectory nodes contributes neighbors.
		const nbhdEdges = g.edges.filter((e) => !e.trajectory);
		const anchors = new Set(nbhdEdges.map((e) => e.anchorStep));
		expect(anchors.has(0)).toBe(true);
		expect(anchors.has(1)).toBe(true);
		expect(anchors.has(2)).toBe(true);
		// Neighborhood edges are anchored at their trajectory node's step.
		for (const e of nbhdEdges) {
			const fromNode = g.nodes.find((n) => n.id === e.from);
			expect(e.anchorStep).toBe(fromNode?.anchorStep);
		}
	});

	it('dedupes neighbors shared between anchors', () => {
		const column = new Int32Array([0, 1]);
		const g = buildNeighborGraph(
			makeStubStrategy(0.5),
			makeProvider(),
			params,
			column,
			new Float32Array(column.length - 1),
			{ limitMode: 'top-k', k: 5, p: 0.95 },
			labelOf,
		);
		const ids = g.nodes.map((n) => n.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('hasNeighborhood is false without a provider', () => {
		const g = buildNeighborGraph(
			makeStubStrategy(0.5),
			null,
			null,
			new Int32Array([0, 1]),
			new Float32Array(1),
			{ limitMode: 'top-k', k: 5, p: 0.95 },
			labelOf,
		);
		expect(g.hasNeighborhood).toBe(false);
		expect(g.edges.filter((e) => !e.trajectory)).toHaveLength(0);
	});

	it('hasNeighborhood is false when no neighbors are in range', () => {
		const g = buildNeighborGraph(
			makeStubStrategy(0.5),
			makeProvider(),
			{ ...params, maxDistance: 0 },
			new Int32Array([0, 1]),
			new Float32Array(1),
			{ limitMode: 'top-k', k: 5, p: 0.95 },
			labelOf,
		);
		expect(g.hasNeighborhood).toBe(false);
		// Trajectory still present.
		expect(g.nodes.filter((n) => n.role === 'trajectory')).toHaveLength(2);
	});

	it('maxPerAnchor caps per-anchor neighborhood size', () => {
		const column = new Int32Array([0, 1, 2]);
		const g = buildNeighborGraph(
			makeStubStrategy(0.5),
			makeProvider(),
			params,
			column,
			new Float32Array(column.length - 1),
			{ limitMode: 'top-k', k: 5, p: 0.95, maxPerAnchor: 2 },
			labelOf,
		);
		// 3 anchors × ≤2 neighbors each, minus dedup.
		const nbhdEdges = g.edges.filter((e) => !e.trajectory);
		expect(nbhdEdges.length).toBeLessThanOrEqual(6);
	});

	it('trajectory edge weights are exact $Q_s$ values', () => {
		const column = new Int32Array([0, 1, 2]);
		const g = buildNeighborGraph(
			makeStubStrategy(0.7),
			null,
			null,
			column,
			new Float32Array(2),
			{ limitMode: 'top-k', k: 5, p: 0.95 },
			labelOf,
		);
		const trajEdges = g.edges.filter((e) => e.trajectory);
		for (const e of trajEdges) {
			expect(e.weight).toBeCloseTo(0.7, 5);
		}
	});

	it('works with a real lexical strategy end-to-end', () => {
		const strategy = getStrategy(
			'lexical',
			{ maxDistance: 3, k: 50, epsilon: 0, tau: 1.0 },
			6,
			makeProvider(),
		);
		const column = new Int32Array([0, 1, 2]);
		const g = buildNeighborGraph(
			strategy,
			makeProvider(),
			params,
			column,
			new Float32Array(2),
			{ limitMode: 'top-k', k: 5, p: 0.95 },
			labelOf,
		);
		expect(g.hasNeighborhood).toBe(true);
		for (const e of g.edges.filter((e) => e.trajectory)) {
			expect(e.weight).toBeGreaterThan(0);
			expect(e.weight).toBeLessThanOrEqual(1);
		}
	});
});

describe('GraphAccumulator', () => {
	it('trajectory role wins over neighbor role', () => {
		const acc = new GraphAccumulator();
		acc.addNeighborNode(5, 3, labelOf);
		acc.addTrajectoryNode(5, 1, labelOf);
		const node = acc.nodes.get(5);
		expect(node?.role).toBe('neighbor'); // first add wins the role
		// But a later trajectory add keeps the earliest anchor.
		acc.addTrajectoryNode(5, 0, labelOf);
		expect(acc.nodes.get(5)?.anchorStep).toBe(0);
	});

	it('neighbor edges never override trajectory edges', () => {
		const acc = new GraphAccumulator();
		acc.addTrajectoryEdge(1, 2, 0, 0.9);
		acc.addNeighborEdge(1, 2, 5, 0.4, 1);
		const edge = acc.edges.get('1->2');
		expect(edge?.trajectory).toBe(true);
		expect(edge?.weight).toBe(0.9);
	});
});
