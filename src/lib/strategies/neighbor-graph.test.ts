import { describe, it, expect } from 'vitest';
import { buildNeighborGraph } from './neighbor-graph.js';
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
 * `token + 1` (mod K) and the rest uniformly. Lets tests assert exact
 * trajectory-edge weights.
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

// Trajectory column: $x_0 = 0 \to x_1 = 1 \to x_2 = 2$; betas for 2 steps.
const column = new Int32Array([0, 1, 2]);
const betas = new Float32Array([0.5, 0.5]);

describe('buildNeighborGraph', () => {
	it('always includes the trajectory chain with exact edge weights', () => {
		const strategy = makeStubStrategy(0.7);
		const g = buildNeighborGraph(
			strategy,
			null,
			null,
			column,
			betas,
			{ limitMode: 'top-k', k: 5, p: 0.95 },
			labelOf,
		);
		const trajNodes = g.nodes.filter((n) => n.role === 'trajectory');
		expect(trajNodes.map((n) => n.id)).toEqual([0, 1, 2]);
		expect(trajNodes.map((n) => n.step)).toEqual([0, 1, 2]);

		const trajEdges = g.edges.filter((e) => e.trajectory);
		expect(trajEdges).toHaveLength(2);
		// Exact $Q_s$ values from the stub: mass 0.7 on token+1 (Float32).
		expect(trajEdges[0]).toMatchObject({ from: 0, to: 1 });
		expect(trajEdges[0]!.weight).toBeCloseTo(0.7, 5);
		expect(trajEdges[1]).toMatchObject({ from: 1, to: 2 });
		expect(trajEdges[1]!.weight).toBeCloseTo(0.7, 5);
	});

	it('hasNeighborhood is false without a provider', () => {
		const g = buildNeighborGraph(
			makeStubStrategy(0.5),
			null,
			null,
			column,
			betas,
			{ limitMode: 'top-k', k: 5, p: 0.95 },
			labelOf,
		);
		expect(g.hasNeighborhood).toBe(false);
		expect(g.nodes.filter((n) => n.role === 'neighbor')).toHaveLength(0);
	});

	it('hasNeighborhood is false when no neighbors are in range', () => {
		const strategy = makeStubStrategy(0.5);
		const g = buildNeighborGraph(
			strategy,
			makeProvider(),
			{ ...params, maxDistance: 0 },
			column,
			betas,
			{ limitMode: 'top-k', k: 5, p: 0.95 },
			labelOf,
		);
		expect(g.hasNeighborhood).toBe(false);
		// Trajectory still present.
		expect(g.nodes.filter((n) => n.role === 'trajectory')).toHaveLength(3);
	});

	it('adds 1-hop neighborhood of the current token', () => {
		const strategy = makeStubStrategy(0.5);
		const g = buildNeighborGraph(
			strategy,
			makeProvider(),
			params,
			column,
			betas,
			{ limitMode: 'top-k', k: 5, p: 0.95 },
			labelOf,
		);
		expect(g.hasNeighborhood).toBe(true);
		const neighbors = g.nodes.filter((n) => n.role === 'neighbor');
		expect(neighbors.length).toBeGreaterThan(0);
		// All neighborhood edges originate at the current token (2).
		for (const e of g.edges.filter((e) => !e.trajectory)) {
			expect(e.from).toBe(2);
		}
	});

	it('neighborhood edges are floor-free softmax weights', () => {
		const strategy = makeStubStrategy(0.5);
		const g = buildNeighborGraph(
			strategy,
			makeProvider(),
			params,
			column,
			betas,
			{ limitMode: 'top-k', k: 5, p: 0.95 },
			labelOf,
		);
		const neighEdges = g.edges.filter((e) => !e.trajectory);
		let sum = 0;
		for (const e of neighEdges) sum += e.weight;
		// Truncation may drop mass, so only bound it.
		expect(sum).toBeGreaterThan(0);
		expect(sum).toBeLessThanOrEqual(1 + 1e-5);
	});

	it('maxPerHop caps neighborhood size', () => {
		const strategy = makeStubStrategy(0.5);
		const g = buildNeighborGraph(
			strategy,
			makeProvider(),
			params,
			column,
			betas,
			{ limitMode: 'top-k', k: 5, p: 0.95, maxPerHop: 2 },
			labelOf,
		);
		// Current token is 2; its neighbors 1 and 0 are already on the
		// trajectory, so only 1 fresh neighbor node survives the cap.
		expect(g.nodes.filter((n) => n.role === 'neighbor')).toHaveLength(1);
	});

	it('works with a real lexical strategy end-to-end', () => {
		const strategy = getStrategy(
			'lexical',
			{ maxDistance: 3, k: 50, epsilon: 0, tau: 1.0 },
			6,
			makeProvider(),
		);
		const g = buildNeighborGraph(
			strategy,
			makeProvider(),
			params,
			column,
			betas,
			{ limitMode: 'top-k', k: 5, p: 0.95 },
			labelOf,
		);
		expect(g.hasNeighborhood).toBe(true);
		const trajEdges = g.edges.filter((e) => e.trajectory);
		expect(trajEdges).toHaveLength(2);
		for (const e of trajEdges) {
			expect(e.weight).toBeGreaterThan(0);
			expect(e.weight).toBeLessThanOrEqual(1);
		}
	});

	it('collapses consecutive stay events into one node with a count', () => {
		// A token that stayed put: $x_0 = x_1 = 4$.
		const col = new Int32Array([4, 4, 4]);
		const strategy = makeStubStrategy(0.5);
		const g = buildNeighborGraph(
			strategy,
			null,
			null,
			col,
			betas,
			{ limitMode: 'top-k', k: 5, p: 0.95 },
			labelOf,
		);
		// One collapsed node covering all 3 steps.
		const trajNodes = g.nodes.filter((n) => n.role === 'trajectory');
		expect(trajNodes).toHaveLength(1);
		expect(trajNodes[0]!.count).toBe(3);
		// Stay edges still recorded (2 of them).
		expect(g.edges.filter((e) => e.trajectory)).toHaveLength(2);
	});
});
