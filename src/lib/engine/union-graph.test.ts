import { describe, it, expect } from 'vitest';
import { buildUnionGraph, occupancyAt } from './union-graph.js';
import { NeighborhoodProvider } from '../strategies/neighborhood.js';
import type { DistanceModel } from '../strategies/distance-model.js';

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
/** K = 6, so the mask sentinel is id 6. */
const MASK = 6;

/** Column-major convenience: build rows from per-position columns. */
function rowsFromColumns(columns: number[][], T: number, L: number): Int32Array {
	const rows = new Int32Array((T + 1) * L);
	for (let i = 0; i < L; i++) {
		for (let s = 0; s <= T; s++) rows[s * L + i] = columns[i]![s]!;
	}
	return rows;
}

const baseLimits = { limitMode: 'top-k' as const, k: 5, p: 0.95, maxPerAnchor: 8, maxNodes: 20000 };

describe('buildUnionGraph', () => {
	it('merges all positions: one node per distinct token, edges carry counts', async () => {
		// Both positions take 0 → 1 at step 1, so the edge count is 2.
		const rows = rowsFromColumns(
			[
				[0, 1, 1],
				[0, 1, 1],
			],
			2,
			2,
		);
		const g = await buildUnionGraph({
			rows,
			T: 2,
			L: 2,
			maskId: MASK,
			provider: null,
			params: null,
			limits: baseLimits,
			labelOf,
		});
		expect(g.nodeCount).toBe(2);
		expect(g.edgeSrc).toHaveLength(1);
		expect(g.edgeCount[0]).toBe(2);
		expect(g.edgeFirstStep[0]).toBe(1);
		expect(g.edgeTraj[0]).toBe(1);
		// Revealed exactly when the transition completes.
		expect([...g.revealStep]).toEqual([0, 1]);
	});

	it('stays produce no edges; distinct transitions keep their first step', async () => {
		// Position 0 never changes; position 1 changes once at step 2.
		const rows = rowsFromColumns(
			[
				[0, 0, 0],
				[1, 1, 2],
			],
			2,
			2,
		);
		const g = await buildUnionGraph({
			rows,
			T: 2,
			L: 2,
			maskId: MASK,
			provider: null,
			params: null,
			limits: baseLimits,
			labelOf,
		});
		expect(g.edgeSrc).toHaveLength(1);
		expect(g.edgeFirstStep[0]).toBe(2);
		expect(g.edgeCount[0]).toBe(1);
	});

	it('records the mask sentinel with a [MASK] label', async () => {
		const rows = rowsFromColumns([[0, MASK, MASK]], 2, 1);
		const g = await buildUnionGraph({
			rows,
			T: 2,
			L: 1,
			maskId: MASK,
			provider: null,
			params: null,
			limits: baseLimits,
			labelOf,
		});
		const maskNode = g.ids.indexOf(MASK);
		expect(maskNode).toBeGreaterThanOrEqual(0);
		expect(g.labels[maskNode]).toBe('[MASK]');
	});

	it('hasNeighborhood is false without a provider', async () => {
		const rows = rowsFromColumns([[0, 1]], 1, 1);
		const g = await buildUnionGraph({
			rows,
			T: 1,
			L: 1,
			maskId: MASK,
			provider: null,
			params: null,
			limits: baseLimits,
			labelOf,
		});
		expect(g.hasNeighborhood).toBe(false);
		expect(g.truncated).toBe(false);
	});

	it('neighbor-only nodes reveal at their anchor’s first step', async () => {
		// Single position 0 → 0 → 1: node 1 is a trajectory node revealed
		// at step 2; nodes 2 and 3 are neighbors of node 0, revealed at 0.
		const rows = rowsFromColumns([[0, 0, 1]], 2, 1);
		const g = await buildUnionGraph({
			rows,
			T: 2,
			L: 1,
			maskId: MASK,
			provider: makeProvider(),
			params,
			limits: baseLimits,
			labelOf,
		});
		expect(g.hasNeighborhood).toBe(true);
		const n1 = g.ids.indexOf(1);
		const n2 = g.ids.indexOf(2);
		expect(g.trajStep[n1]).toBe(2);
		// Node 1 is also a neighbor of node 0 (anchor step 0), so it is
		// visible from step 0 even though it joins a path at step 2.
		expect(g.revealStep[n1]).toBe(0);
		expect(g.trajStep[n2]).toBe(-1);
		expect(g.revealStep[n2]).toBe(0);
		// Neighbor edges appear when their anchor first joins a path.
		for (let e = 0; e < g.edgeSrc.length; e++) {
			if (!g.edgeTraj[e]) {
				expect(g.edgeFirstStep[e]).toBe(g.trajStep[g.edgeSrc[e]!]);
			}
		}
	});

	it('a neighbor visited later is promoted (reveal stays at its anchor step)', async () => {
		// 0 → 1 → 2: node 2 first appears as a neighbor of node 0 (step 0)
		// and is visited as a trajectory node at step 2.
		const rows = rowsFromColumns([[0, 1, 2]], 2, 1);
		const g = await buildUnionGraph({
			rows,
			T: 2,
			L: 1,
			maskId: MASK,
			provider: makeProvider(),
			params,
			limits: baseLimits,
			labelOf,
		});
		const n2 = g.ids.indexOf(2);
		expect(g.trajStep[n2]).toBe(2);
		expect(g.revealStep[n2]).toBe(0);
	});

	it('neighbor edges never override a trajectory edge for the same pair', async () => {
		// 0 → 1: node 1 is also a neighbor of node 0, but the pair 0→1 is
		// a trajectory edge and must stay one.
		const rows = rowsFromColumns([[0, 1]], 1, 1);
		const g = await buildUnionGraph({
			rows,
			T: 1,
			L: 1,
			maskId: MASK,
			provider: makeProvider(),
			params,
			limits: baseLimits,
			labelOf,
		});
		const n0 = g.ids.indexOf(0);
		const n1 = g.ids.indexOf(1);
		const pair = g.edgeSrc.findIndex((src, e) => src === n0 && g.edgeDst[e] === n1);
		expect(pair).toBeGreaterThanOrEqual(0);
		expect(g.edgeTraj[pair]).toBe(1);
	});

	it('dedups neighbor edges by token id even when node order differs', async () => {
		// Token 3 lands at node index 0, so keying by node index would
		// miss the existing trajectory edge 3→0 and add a parallel
		// neighbor edge for the same token pair.
		const rows = rowsFromColumns([[3, 0, 1]], 2, 1);
		const g = await buildUnionGraph({
			rows,
			T: 2,
			L: 1,
			maskId: MASK,
			provider: makeProvider(),
			params,
			limits: baseLimits,
			labelOf,
		});
		const n3 = g.ids.indexOf(3);
		const n0 = g.ids.indexOf(0);
		// Sanity: node indices do not coincide with token ids here.
		expect(n3).toBe(0);
		expect(n0).toBe(1);
		const between = [];
		for (let e = 0; e < g.edgeSrc.length; e++) {
			if (g.edgeSrc[e] === n3 && g.edgeDst[e] === n0) between.push(g.edgeTraj[e]);
		}
		expect(between).toEqual([1]); // exactly one, and it is the trajectory edge
	});

	it('maxPerAnchor caps the neighborhood per anchor', async () => {
		// Three trajectory nodes, ≤ 2 neighbors each.
		const rows = rowsFromColumns([[0, 1, 2]], 2, 1);
		const g = await buildUnionGraph({
			rows,
			T: 2,
			L: 1,
			maskId: MASK,
			provider: makeProvider(),
			params,
			limits: { ...baseLimits, maxPerAnchor: 2 },
			labelOf,
		});
		const nbhdEdges = [...g.edgeTraj].filter((t) => !t).length;
		expect(nbhdEdges).toBeLessThanOrEqual(6);
	});

	it('shrinks the neighborhood and flags truncation on a tight node budget', async () => {
		const rows = rowsFromColumns([[0, 1, 2]], 2, 1);
		const g = await buildUnionGraph({
			rows,
			T: 2,
			L: 1,
			maskId: MASK,
			provider: makeProvider(),
			params,
			limits: { ...baseLimits, maxPerAnchor: 8, maxNodes: 8 },
			labelOf,
		});
		expect(g.nodeCount).toBeLessThanOrEqual(8);
		expect(g.truncated).toBe(true);
	});

	it('skips the neighborhood entirely when trajectory nodes exhaust the budget', async () => {
		const rows = rowsFromColumns([[0, 1, 2, 3, 4, 5]], 5, 1);
		const g = await buildUnionGraph({
			rows,
			T: 5,
			L: 1,
			maskId: MASK,
			provider: makeProvider(),
			params,
			limits: { ...baseLimits, maxPerAnchor: 8, maxNodes: 6 },
			labelOf,
		});
		expect(g.nodeCount).toBe(6);
		expect(g.hasNeighborhood).toBe(false);
		expect(g.truncated).toBe(true);
	});

	it('reports progress across the neighborhood phase', async () => {
		const rows = rowsFromColumns([[0, 1, 2]], 2, 1);
		const seen: [number, number][] = [];
		await buildUnionGraph({
			rows,
			T: 2,
			L: 1,
			maskId: MASK,
			provider: makeProvider(),
			params,
			limits: baseLimits,
			labelOf,
			onProgress: (done, total) => seen.push([done, total]),
		});
		// The final progress report covers all trajectory nodes.
		expect(seen.at(-1)).toEqual([3, 3]);
	});

	it('throws when the distinct trajectory tokens exceed the node limit', async () => {
		const rows = rowsFromColumns([[0, 1, 2, 3, 4, 5]], 5, 1);
		await expect(
			buildUnionGraph({
				rows,
				T: 5,
				L: 1,
				maskId: MASK,
				provider: null,
				params: null,
				limits: { ...baseLimits, maxNodes: 5 },
				labelOf,
			}),
		).rejects.toThrow(/Too many distinct tokens/);
	});

	it('seeds the position stalks as a block rather than a single row', async () => {
		// 64 positions, each jumping once to a fresh token: short stalks.
		const L = 64;
		const columns = Array.from({ length: L }, (_, i) => [2 * i, 2 * i + 1]);
		const rows = rowsFromColumns(columns, 1, L);
		const g = await buildUnionGraph({
			rows,
			T: 1,
			L,
			maskId: 1000,
			provider: null,
			params: null,
			limits: baseLimits,
			labelOf,
		});
		let minX = Infinity;
		let maxX = -Infinity;
		let minY = Infinity;
		let maxY = -Infinity;
		for (let i = 0; i < g.nodeCount; i++) {
			minX = Math.min(minX, g.initX[i]!);
			maxX = Math.max(maxX, g.initX[i]!);
			minY = Math.min(minY, g.initY[i]!);
			maxY = Math.max(maxY, g.initY[i]!);
		}
		const aspect = (maxY - minY) / (maxX - minX);
		expect(aspect).toBeGreaterThan(0.5);
		expect(aspect).toBeLessThan(2);
	});
});

describe('occupancyAt', () => {
	it('counts how many positions hold each node’s token', () => {
		const idToNode = new Map<number, number>([
			[7, 0],
			[9, 1],
		]);
		const row = new Int32Array([7, 9, 7, 7, 11]);
		const occ = occupancyAt(row, idToNode, 3);
		expect([...occ]).toEqual([3, 1, 0]);
	});
});
