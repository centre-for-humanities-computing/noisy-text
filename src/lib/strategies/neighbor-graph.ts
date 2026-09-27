/**
 * Build the inspection graph for the hover tooltip: the hovered token's
 * trajectory chain plus the 1-hop neighborhood of its current token.
 *
 * Pure function over a strategy + optional provider: no worker, no DOM.
 *
 * - **Trajectory edges** carry the exact transition probability
 *   $Q_s(x_{s+1} \mid x_s)$ from `strategy.getLocalDistribution` (this
 *   *includes* the ergodicity floor — it is the true probability the
 *   walk used).
 * - **Neighborhood edges** carry the floor-free softmax weights from
 *   `resolveNeighbors` (the ergodicity floor is excluded, per the
 *   inspection spec).
 *
 * The trajectory is always present; the neighborhood is optional
 * (`hasNeighborhood: false` when the strategy has no provider or no
 * neighbors are in range).
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
	 * Maximum neighborhood nodes kept for legibility, applied after the
	 * top-$k$/$p$ cut (heaviest weights first). Default 8.
	 */
	maxPerHop?: number;
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
	const nodes: NeighborGraphNode[] = [];
	const edges: NeighborGraphEdge[] = [];
	// Token ids on the trajectory (for neighbor dedup). Trajectory nodes
	// themselves are emitted per step — repeated ids (stay events) are
	// kept so the chain shows every step.
	const seen = new Set<number>();

	// ---- Trajectory chain: $x_0 \to x_1 \to \cdots \to x_t$ ----
	// Consecutive identical tokens (stay events) collapse into one node
	// carrying a repeat count; each step still contributes its edge so
	// stay probabilities remain visible.
	for (let s = 0; s < column.length; s++) {
		const id = column[s]!;
		const last = nodes[nodes.length - 1];
		if (last && last.role === 'trajectory' && last.id === id) {
			last.count = (last.count ?? 1) + 1;
		} else {
			nodes.push({ id, role: 'trajectory', step: s, label: labelOf(id), count: 1 });
		}
		seen.add(id);
		if (s < column.length - 1) {
			// Exact transition probability: row $Q_s$ of the strategy at
			// $\beta_s$, read at the actual next token. Strategies without
			// `getLocalDistribution` get weight 1 (the walk did happen).
			const next = column[s + 1]!;
			const dist = strategy.getLocalDistribution?.(id, betas[s] ?? 0);
			edges.push({
				from: id,
				to: next,
				weight: dist ? (dist[next] ?? 0) : 1,
				dist: 0,
				trajectory: true,
			});
		}
	}

	// ---- 1-hop neighborhood of the current token ----
	let hasNeighborhood = false;
	const current = column[column.length - 1]!;

	if (provider && params) {
		const { maxDistance, k, tau } = params;
		const resolved = resolveNeighbors(provider.neighborsOf(current), maxDistance, k, tau);
		const limited = applyLimit(resolved, limits.limitMode, limits.k, limits.p);
		if (limited) {
			const maxKeep = limits.maxPerHop ?? 8;
			const kept = truncateByWeight(limited.entries, limited.weights, maxKeep);
			if (kept) {
				hasNeighborhood = true;
				for (let i = 0; i < kept.entries.length; i++) {
					const n = kept.entries[i]!;
					if (!seen.has(n.id)) {
						nodes.push({ id: n.id, role: 'neighbor', step: -1, label: labelOf(n.id) });
						seen.add(n.id);
					}
					edges.push({
						from: current,
						to: n.id,
						weight: kept.weights[i]!,
						dist: n.dist,
						trajectory: false,
					});
				}
			}
		}
	}

	return { nodes, edges, hasNeighborhood };
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
