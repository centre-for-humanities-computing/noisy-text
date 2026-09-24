/**
 * Build a 2-hop neighborhood graph for the hover tooltip.
 *
 * Pure function over a `NeighborhoodProvider`-like source: no worker, no
 * DOM. The ergodicity floor $\varepsilon$ is excluded by construction —
 * only `resolveNeighbors` softmax weights (over $-d/\tau$) are used, never
 * `fillLocalDistribution`.
 *
 * Structure: center node (hop 0) → its top limited neighbors (hop 1) →
 * each hop-1 node's top limited neighbors (hop 2). Each hop's spread is
 * truncated by `applyLimit` (top-$k$ or top-$p$) and weights are
 * renormalized over the survivors, so edge weights within one hop's
 * out-edges sum to 1.
 */

import type {
	NeighborGraph,
	NeighborGraphEdge,
	NeighborGraphNode,
} from '../workers/trajectory.protocol.js';
import type { NeighborhoodProvider } from './neighborhood.js';
import { resolveNeighbors, applyLimit } from './neighbor-softmax.js';

/** Read-time filter params shared by lexical and char-overlap configs. */
export interface NeighborGraphParams {
	maxDistance: number;
	k: number;
	tau: number;
}

/** Spread-limit options for the tooltip graph. */
export interface NeighborGraphLimits {
	limitMode: 'top-k' | 'top-p';
	/** Top-k cutoff (used when `limitMode === 'top-k'`). */
	k: number;
	/** Cumulative probability cutoff in $[0, 1]$ (used when `limitMode === 'top-p'`). */
	p: number;
	/**
	 * Maximum nodes kept per hop for legibility, applied after the
	 * top-$k$/$p$ cut (heaviest weights first). Hop 2 keeps half this
	 * (rounded up). Default 8.
	 */
	maxPerHop?: number;
}

/**
 * Build the 2-hop graph centered on `token`.
 *
 * @param provider - The neighborhood source (raw distances out to $R_{\max}$).
 * @param params - Read-time filter params (`maxDistance`, `k`, `tau`) from
 *   the active strategy config.
 * @param limits - Spread limits for the display (top-$k$ or top-$p$).
 * @param labelOf - Maps a token id to its display string.
 * @returns The graph, or `null` when the center has no neighbors in range.
 */
export function buildNeighborGraph(
	provider: NeighborhoodProvider,
	token: number,
	params: NeighborGraphParams,
	limits: NeighborGraphLimits,
	labelOf: (id: number) => string,
): NeighborGraph | null {
	const { maxDistance, k, tau } = params;
	const maxPerHop = limits.maxPerHop ?? 8;
	const maxHop2 = Math.ceil(maxPerHop / 2);

	const centerResolved = resolveNeighbors(provider.neighborsOf(token), maxDistance, k, tau);
	const centerLimited = applyLimit(centerResolved, limits.limitMode, limits.k, limits.p);
	if (!centerLimited) return null;

	// Truncate to the heaviest `maxPerHop` entries for legibility.
	const centerEntries = truncateByWeight(centerLimited.entries, centerLimited.weights, maxPerHop);
	if (!centerEntries) return null;

	const nodes: NeighborGraphNode[] = [{ id: token, hop: 0, label: labelOf(token) }];
	const edges: NeighborGraphEdge[] = [];
	const seen = new Set<number>([token]);

	for (let i = 0; i < centerEntries.entries.length; i++) {
		const n = centerEntries.entries[i]!;
		if (!seen.has(n.id)) {
			nodes.push({ id: n.id, hop: 1, label: labelOf(n.id) });
			seen.add(n.id);
		}
		edges.push({ from: token, to: n.id, weight: centerEntries.weights[i]!, dist: n.dist });
	}

	// Second hop: for each hop-1 node, resolve and limit its own neighbors.
	for (const n of centerEntries.entries) {
		const resolved = resolveNeighbors(provider.neighborsOf(n.id), maxDistance, k, tau);
		const limited = applyLimit(resolved, limits.limitMode, limits.k, limits.p);
		if (!limited) continue;

		const hop2 = truncateByWeight(limited.entries, limited.weights, maxHop2);
		if (!hop2) continue;

		for (let i = 0; i < hop2.entries.length; i++) {
			const m = hop2.entries[i]!;
			if (m.id === token) continue; // don't re-add the center as a 2-hop node
			if (!seen.has(m.id)) {
				nodes.push({ id: m.id, hop: 2, label: labelOf(m.id) });
				seen.add(m.id);
			}
			edges.push({ from: n.id, to: m.id, weight: hop2.weights[i]!, dist: m.dist });
		}
	}

	return { nodes, edges };
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
