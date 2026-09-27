/**
 * Build the inspection graph for the hover tooltip: the hovered token's
 * trajectory (the distinct tokens it passed through) plus the 1-hop
 * neighborhood of **every** trajectory node.
 *
 * Pure function over a strategy + optional provider: no worker, no DOM.
 * Designed as a composable accumulator so a future "all trajectories in
 * one graph" view can reuse `addTrajectory` / `addNeighborhood` on a
 * shared accumulator.
 *
 * Semantics:
 * - **Token-space dedup**: a token id is one node, no matter how many
 *   steps it appears at in the trajectory (a revisit is the same node).
 * - **Stays produce nothing**: consecutive equal tokens add no edge; only
 *   actual changes do. Each change edge records the steps $s$ at which
 *   that transition was taken (a pair can recur).
 * - **Trajectory edges** carry the exact transition probability
 *   $Q_s(x_{s+1} \mid x_s)$ from `strategy.getLocalDistribution` (this
 *   *includes* the ergodicity floor — it is the true probability the
 *   walk used).
 * - **Neighborhood edges** carry the floor-free softmax weights from
 *   `resolveNeighbors` (the ergodicity floor is excluded).
 * - The neighborhood is optional (`hasNeighborhood: false` when the
 *   strategy has no provider or no neighbors are in range).
 */

import type {
	NeighborGraph,
	NeighborGraphEdge,
	NeighborGraphNode,
} from '../workers/trajectory.protocol.js';
import type { NoiseStrategy } from './types.js';
import type { NeighborhoodProvider } from './neighborhood.js';
import { resolveNeighbors, applyLimit } from './neighbor-softmax.js';

/** Read-time filter params shared by lexical and char-overlap configs. */
export interface NeighborGraphParams {
	maxDistance: number;
	k: number;
	tau: number;
}

/** Spread-limit options for the tooltip neighborhood. */
export interface NeighborGraphLimits {
	limitMode: 'top-k' | 'top-p';
	/** Top-k cutoff (used when `limitMode === 'top-k'`). */
	k: number;
	/** Cumulative probability cutoff in $[0, 1]$ (used when `limitMode === 'top-p'`). */
	p: number;
	/**
	 * Maximum neighborhood nodes kept per anchor, applied after the
	 * top-$k$/$p$ cut (heaviest weights first). Default 8.
	 */
	maxPerAnchor?: number;
}

/**
 * Mutable graph accumulator over token-space nodes.
 *
 * Nodes are keyed by token id; edges by `from → to` (directed). Trajectory
 * edges accumulate the set of steps at which each transition was taken.
 * Reusable across multiple trajectories for the future all-trajectories
 * view.
 */
export class GraphAccumulator {
	readonly nodes = new Map<number, NeighborGraphNode>();
	readonly edges = new Map<string, NeighborGraphEdge>();

	/** Add a trajectory node (or keep the earliest anchor of an existing one). */
	addTrajectoryNode(id: number, step: number, labelOf: (id: number) => string): void {
		const existing = this.nodes.get(id);
		if (existing) {
			// Keep the earliest appearance as the chronology anchor.
			if (step < existing.anchorStep) existing.anchorStep = step;
			return;
		}
		this.nodes.set(id, { id, role: 'trajectory', anchorStep: step, label: labelOf(id) });
	}

	/** Add a neighborhood node anchored at `step`. */
	addNeighborNode(id: number, step: number, labelOf: (id: number) => string): void {
		const existing = this.nodes.get(id);
		if (existing) return; // trajectory role wins; anchor unchanged
		this.nodes.set(id, { id, role: 'neighbor', anchorStep: step, label: labelOf(id) });
	}

	/**
	 * Record a trajectory transition taken at step `s`. Stays (`from ===
	 * to`) are ignored. Repeated transitions accumulate their steps.
	 */
	addTrajectoryEdge(from: number, to: number, step: number, weight: number): void {
		if (from === to) return;
		const key = `${from}->${to}`;
		const existing = this.edges.get(key);
		if (existing) {
			existing.steps.push(step);
			// Keep the latest weight (most recent occurrence).
			existing.weight = weight;
			existing.anchorStep = step;
			return;
		}
		this.edges.set(key, {
			from,
			to,
			weight,
			dist: 0,
			trajectory: true,
			anchorStep: step,
			steps: [step],
		});
	}

	/** Record a floor-free neighborhood edge anchored at `step`. */
	addNeighborEdge(from: number, to: number, step: number, weight: number, dist: number): void {
		if (from === to) return;
		const key = `${from}->${to}`;
		if (this.edges.has(key)) return; // trajectory edge wins
		this.edges.set(key, {
			from,
			to,
			weight,
			dist,
			trajectory: false,
			anchorStep: step,
			steps: [],
		});
	}

	/** Snapshot the accumulated graph. */
	snapshot(hasNeighborhood: boolean): NeighborGraph {
		return {
			nodes: [...this.nodes.values()],
			edges: [...this.edges.values()],
			hasNeighborhood,
		};
	}
}

/**
 * Build the inspection graph.
 *
 * @param strategy - The active strategy (for exact $Q_s$ rows).
 * @param provider - Neighborhood source, or `null` for strategies without
 *   one (identity, uniform, absorbing).
 * @param params - Read-time filter params; required when `provider` is set.
 * @param column - The hovered token's trajectory column $x_0, \ldots, x_t$.
 * @param betas - Schedule values $\beta_0, \ldots, \beta_{t-1}$.
 * @param limits - Spread limits for the neighborhood.
 * @param labelOf - Maps a token id to its display string.
 */
export function buildNeighborGraph(
	strategy: NoiseStrategy,
	provider: NeighborhoodProvider | null,
	params: NeighborGraphParams | null,
	column: Int32Array,
	betas: Float32Array,
	limits: NeighborGraphLimits,
	labelOf: (id: number) => string,
): NeighborGraph {
	const acc = new GraphAccumulator();

	// ---- Trajectory: distinct tokens + change edges ----
	for (let s = 0; s < column.length; s++) {
		acc.addTrajectoryNode(column[s]!, s, labelOf);
		if (s < column.length - 1) {
			const from = column[s]!;
			const to = column[s + 1]!;
			if (from !== to) {
				// Exact transition probability: row $Q_s$ at $\beta_s$, read
				// at the actual next token. Strategies without
				// `getLocalDistribution` get weight 1 (the walk did happen).
				const dist = strategy.getLocalDistribution?.(from, betas[s] ?? 0);
				acc.addTrajectoryEdge(from, to, s, dist ? (dist[to] ?? 0) : 1);
			}
		}
	}

	// ---- 1-hop neighborhood of every trajectory node ----
	let hasNeighborhood = false;
	if (provider && params) {
		const { maxDistance, k, tau } = params;
		const maxKeep = limits.maxPerAnchor ?? 8;
		for (const node of acc.nodes.values()) {
			if (node.role !== 'trajectory') continue;
			const resolved = resolveNeighbors(provider.neighborsOf(node.id), maxDistance, k, tau);
			const limited = applyLimit(resolved, limits.limitMode, limits.k, limits.p);
			if (!limited) continue;
			const kept = truncateByWeight(limited.entries, limited.weights, maxKeep);
			if (!kept) continue;
			hasNeighborhood = true;
			for (let i = 0; i < kept.entries.length; i++) {
				const n = kept.entries[i]!;
				acc.addNeighborNode(n.id, node.anchorStep, labelOf);
				acc.addNeighborEdge(node.id, n.id, node.anchorStep, kept.weights[i]!, n.dist);
			}
		}
	}

	return acc.snapshot(hasNeighborhood);
}

/**
 * Truncate entries to the `max` heaviest weights (descending), keeping
 * the original relative order. Returns `null` if nothing survives.
 */
function truncateByWeight(
	entries: { id: number; dist: number }[],
	weights: Float32Array,
	max: number,
): { entries: { id: number; dist: number }[]; weights: Float32Array } | null {
	if (entries.length === 0) return null;
	if (entries.length <= max) return { entries, weights };

	// Indices sorted by weight descending, take the top `max`, restore order.
	const idx = entries.map((_, i) => i);
	idx.sort((a, b) => weights[b]! - weights[a]!);
	const keep = new Set(idx.slice(0, max));

	const outEntries: { id: number; dist: number }[] = [];
	const outWeights = new Float32Array(max);
	for (let i = 0; i < entries.length && outEntries.length < max; i++) {
		if (keep.has(i)) {
			outEntries.push(entries[i]!);
			outWeights[outEntries.length - 1] = weights[i]!;
		}
	}
	return { entries: outEntries, weights: outWeights };
}
