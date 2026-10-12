/**
 * Build the **union graph** for the full-graph view: one token-space
 * graph merging the trajectories of *all* sequence positions, plus the
 * 1-hop neighborhood of every trajectory node (when the strategy has a
 * provider).
 *
 * This is the "all trajectories in one graph" counterpart of
 * `buildNeighborGraph` (which handles a single hovered position). The
 * same token-space dedup semantics apply — a token id is one node no
 * matter how many positions hold it or how often it is revisited — but
 * nodes and edges additionally carry **reveal steps** so the view can
 * show a stable layout progressively as the slider moves:
 *
 * - `trajStep`: the first step $s$ at which any position held the token
 *   (or $-1$ for neighbor-only nodes).
 * - `revealStep`: when the node becomes visible. Trajectory nodes reveal
 *   at `trajStep`; a neighbor-only node reveals at the earliest
 *   `trajStep` of the trajectory nodes it anchors (it "shadows" the
 *   anchor from the moment the anchor first appears).
 * - Trajectory edges record `firstStep` ($s$, the step at which the
 *   transition $x_{s-1} \to x_s$ was first taken by any position) and
 *   `count` (how many times any position took it). Edge weight in the
 *   per-position inspection graph (the exact $Q_s$ value) is not
 *   meaningful once positions are merged, so counts drive the width
 *   instead.
 * - Neighborhood edges use the same read pipeline as the tooltip
 *   (`resolveNeighbors` → `applyLimit` → `truncateByWeight`) and reveal
 *   with their anchor.
 *
 * Pure over its inputs apart from cooperative `yieldFn` calls, which
 * let the worker post progress and drop stale requests mid-build.
 */

import type { NeighborGraphParams } from '../strategies/neighbor-graph.js';
import { truncateByWeight } from '../strategies/neighbor-graph.js';
import type { NeighborhoodProvider } from '../strategies/neighborhood.js';
import { resolveNeighbors, applyLimit } from '../strategies/neighbor-softmax.js';
import { largeIdealLength } from './force-layout.js';

/** Spread-limit params shared with the tooltip, plus size guards. */
export interface UnionGraphLimits {
	limitMode: 'top-k' | 'top-p';
	/** Top-k cutoff (used when `limitMode === 'top-k'`). */
	k: number;
	/** Cumulative probability cutoff in $[0, 1]$ (used when `limitMode === 'top-p'`). */
	p: number;
	/** Maximum neighborhood nodes kept per anchor (before size guards). Default 8. */
	maxPerAnchor: number;
	/**
	 * Hard cap on total nodes. The distinct trajectory tokens must fit
	 * under it (the build throws otherwise); the neighborhood shrinks to
	 * fill the remaining budget.
	 */
	maxNodes: number;
}

/** The union graph in compact (typed-array) form. */
export interface UnionGraphData {
	/** Number of nodes; all per-node arrays have this length. */
	nodeCount: number;
	/** Number of noise steps the graph was built over. */
	T: number;
	/** Token id per node (the mask sentinel is `maskId`). */
	ids: Int32Array;
	/** First step any position held this token; $-1$ for neighbor-only nodes. */
	trajStep: Int32Array;
	/** Step at which the node becomes visible ($t \ge$ `revealStep`). */
	revealStep: Int32Array;
	/**
	 * Deterministic initial layout positions (world units): trajectory
	 * nodes sit on per-position stalks laid out in a grid, neighbor nodes
	 * on a ring around their anchor. Feed these to `computeForceLayoutLarge`
	 * as `initial` so chains start out untangled; the layout refines them.
	 */
	initX: Float32Array;
	initY: Float32Array;
	/** Display string per node. */
	labels: string[];
	/** Edge endpoints as node indices. */
	edgeSrc: Int32Array;
	edgeDst: Int32Array;
	/** Step at which the edge becomes visible ($t \ge$ `firstStep`). */
	edgeFirstStep: Int32Array;
	/** How many times any position took a trajectory edge (1 for neighbor edges). */
	edgeCount: Int32Array;
	/** 1 for trajectory edges, 0 for neighborhood edges. */
	edgeTraj: Uint8Array;
	hasNeighborhood: boolean;
	/** True when the size guards shrank or skipped the neighborhood. */
	truncated: boolean;
}

export interface UnionGraphBuildOptions {
	/** Full trajectory rows, row-major $(T+1) \times L$. */
	rows: Int32Array;
	/** Number of noise steps $T$. */
	T: number;
	/** Sequence length $L$. */
	L: number;
	/** The mask sentinel id (= vocab size). */
	maskId: number;
	/** Neighborhood source, or `null` for strategies without one. */
	provider: NeighborhoodProvider | null;
	/** Read-time filter params; required when `provider` is set. */
	params: NeighborGraphParams | null;
	limits: UnionGraphLimits;
	/** Maps a token id to its display string. */
	labelOf: (id: number) => string;
	/** Progress callback for the neighborhood phase: `(done, total)`. */
	onProgress?: (done: number, total: number) => void;
	/** Cooperative yield, awaited about every `YIELD_INTERVAL_MS` in the neighborhood pass. */
	yieldFn?: () => Promise<void>;
	/** Abort check, called alongside yields; throws when it returns true. */
	shouldAbort?: () => boolean;
}

/**
 * Minimum time between cooperative yields in the neighborhood pass (ms).
 * Per-anchor cost varies by orders of magnitude across strategies (a
 * char-overlap anchor scans the whole vocabulary), so the interval is
 * time-based rather than a fixed anchor count.
 */
const YIELD_INTERVAL_MS = 50;

/**
 * Seed grid for the position stalks, in units of the layout spacing:
 * the horizontal pitch between neighboring bases, and the gap left below
 * a stalk before the next row of bases (on top of the stalk's length).
 */
const SEED_COL_PITCH = 1;
const SEED_ROW_GAP = 1;

/**
 * Build the union graph over all positions and steps $0..T$.
 *
 * The trajectory pass is a single $O(T \cdot L)$ scan. The neighborhood
 * pass mirrors `buildNeighborGraph`, with the per-anchor cap adapted to
 * the node budget (`maxNodes`) so large neighborhoods degrade
 * gracefully — the result carries `truncated: true` when that happened.
 * The distinct trajectory tokens alone must fit the budget; otherwise
 * the build throws with a message the UI can show.
 */
export async function buildUnionGraph(opts: UnionGraphBuildOptions): Promise<UnionGraphData> {
	const { rows, T, L, maskId, provider, params, limits, labelOf } = opts;

	// ---- Node registry: token id → node index ----
	const ids: number[] = [];
	const trajSteps: number[] = [];
	const reveals: number[] = [];
	/** Anchor node index for neighbor-only nodes ($-1$ for traj nodes). */
	const anchorOf: number[] = [];
	const idToNode = new Map<number, number>();

	/** Node for a trajectory token; a revisit keeps the earliest step. */
	function getOrCreateTrajectory(id: number, step: number): number {
		const existing = idToNode.get(id);
		if (existing !== undefined) {
			if (step < trajSteps[existing]!) {
				trajSteps[existing] = step;
				reveals[existing] = step;
			}
			return existing;
		}
		const ni = ids.length;
		idToNode.set(id, ni);
		ids.push(id);
		trajSteps.push(step);
		reveals.push(step);
		anchorOf.push(-1);
		return ni;
	}

	/** Node for a neighbor token, or `null` when the node budget is spent. */
	function getOrCreateNeighbor(id: number, anchor: number, anchorStep: number): number | null {
		const existing = idToNode.get(id);
		if (existing !== undefined) {
			// Visible as a neighbor from the anchor's step, even if the node
			// is a trajectory node.
			if (anchorStep < reveals[existing]!) reveals[existing] = anchorStep;
			return existing;
		}
		if (ids.length >= limits.maxNodes) return null; // budget exhausted
		const ni = ids.length;
		idToNode.set(id, ni);
		ids.push(id);
		trajSteps.push(-1);
		reveals.push(anchorStep);
		anchorOf.push(anchor);
		return ni;
	}

	// ---- Pass 1: trajectories of all positions (stays add nothing) ----
	// Edge registry keyed by `from * (maskId + 1) + to` (ids < maskId+1).
	type EdgeAcc = { src: number; dst: number; first: number; count: number; traj: number };
	const edgeMap = new Map<number, EdgeAcc>();

	for (let i = 0; i < L; i++) {
		let prev = rows[i]!;
		getOrCreateTrajectory(prev, 0);
		for (let s = 1; s <= T; s++) {
			const cur = rows[s * L + i]!;
			getOrCreateTrajectory(cur, s);
			if (cur !== prev) {
				const key = prev * (maskId + 1) + cur;
				const e = edgeMap.get(key);
				if (e) {
					if (s < e.first) e.first = s;
					e.count++;
				} else {
					edgeMap.set(key, {
						src: idToNode.get(prev)!,
						dst: idToNode.get(cur)!,
						first: s,
						count: 1,
						traj: 1,
					});
				}
			}
			prev = cur;
		}
	}

	const nodeCountAtTraj = ids.length;
	if (nodeCountAtTraj > limits.maxNodes) {
		throw new Error(
			`Too many distinct tokens for the full graph: ${nodeCountAtTraj} (limit ${limits.maxNodes}). ` +
				'Try a shorter input, fewer steps, or a lower rate.',
		);
	}

	// ---- Pass 2: 1-hop neighborhood of every trajectory node ----
	let hasNeighborhood = false;
	let truncated = false;

	if (provider && params) {
		const total = nodeCountAtTraj;
		const budget = limits.maxNodes - nodeCountAtTraj;
		if (budget <= 0) {
			// The trajectory alone fills the node budget: no neighborhood fits.
			truncated = true;
		} else {
			// Shrink the per-anchor cap to fit the budget (dedup makes the
			// estimate conservative; the hard cap below catches the rest).
			const perAnchor = Math.min(
				limits.maxPerAnchor,
				Math.max(1, Math.floor(budget / Math.max(1, total))),
			);
			if (perAnchor < limits.maxPerAnchor) truncated = true;

			const { maxDistance, k, tau } = params;
			let done = 0;
			let lastYield = performance.now();
			for (let anchor = 0; anchor < nodeCountAtTraj; anchor++) {
				const anchorStep = trajSteps[anchor]!;
				const resolved = resolveNeighbors(provider.neighborsOf(ids[anchor]!), maxDistance, k, tau);
				const limited = applyLimit(resolved, limits.limitMode, limits.k, limits.p);
				const kept = limited ? truncateByWeight(limited.entries, limited.weights, perAnchor) : null;
				if (kept) {
					hasNeighborhood = true;
					for (let j = 0; j < kept.entries.length; j++) {
						const n = kept.entries[j]!;
						const dst = getOrCreateNeighbor(n.id, anchor, anchorStep);
						if (dst === null) {
							truncated = true;
							break;
						}
						// Key in the same token-id space as trajectory edges
						// (ids, not node indices) so dedup works regardless
						// of insertion order.
						const key = ids[anchor]! * (maskId + 1) + n.id;
						if (!edgeMap.has(key)) {
							edgeMap.set(key, {
								src: anchor,
								dst,
								first: anchorStep,
								count: 1,
								traj: 0,
							});
						}
					}
				}
				done++;
				if (performance.now() - lastYield >= YIELD_INTERVAL_MS) {
					opts.onProgress?.(done, total);
					if (opts.shouldAbort?.()) throw new Error('union-graph aborted');
					await opts.yieldFn?.();
					lastYield = performance.now();
				}
			}
			opts.onProgress?.(total, total);
		}
	}

	const nodeCount = ids.length;

	// ---- Initial positions: one stalk per sequence position ----
	// Each position gets a base cell in a near-square grid, filled row by
	// row in position order. Its tokens grow downward (+y), one generation
	// per step, each seeded next to the token it replaced when it first
	// appeared, so chains start as short edge bundles hanging from their
	// base. A single row of L bases would make the graph flat; stacking the
	// bases in rows keeps the block about as tall as it is wide. The row
	// pitch follows the mean number of distinct tokens per position, so the
	// stalks fit their rows. Deterministic. The spacing is the layout's
	// ideal length for the final node count, so the seed starts at the
	// scale the layout uses.
	const spacing = largeIdealLength(nodeCount);
	const colPitch = spacing * SEED_COL_PITCH;
	const rowPitch = spacing * (nodeCountAtTraj / Math.max(1, L) + SEED_ROW_GAP);
	const cols = Math.min(
		Math.max(L, 1),
		Math.max(1, Math.round(Math.sqrt((L * rowPitch) / colPitch))),
	);
	const gx = new Float32Array(nodeCountAtTraj);
	const gy = new Float32Array(nodeCountAtTraj);
	const placed = new Uint8Array(nodeCountAtTraj);
	const fract = (v: number): number => v - Math.floor(v);
	for (let i = 0; i < L; i++) {
		const ni = idToNode.get(rows[i]!)!;
		if (!placed[ni]) {
			gx[ni] = ((i % cols) - (cols - 1) / 2) * colPitch;
			gy[ni] = Math.floor(i / cols) * rowPitch;
			placed[ni] = 1;
		}
	}
	for (let s = 1; s <= T; s++) {
		for (let i = 0; i < L; i++) {
			const cni = idToNode.get(rows[s * L + i]!)!;
			if (placed[cni]) continue;
			const pni = idToNode.get(rows[(s - 1) * L + i]!)!;
			const j = fract(0.618034 * (cni + 1));
			gx[cni] = gx[pni]! + (j - 0.5) * spacing;
			gy[cni] = gy[pni]! + spacing * (0.7 + 0.6 * j);
			placed[cni] = 1;
		}
	}

	// ---- Snapshot into typed arrays ----
	const edgeCount = edgeMap.size;
	const edgeSrc = new Int32Array(edgeCount);
	const edgeDst = new Int32Array(edgeCount);
	const edgeFirstStep = new Int32Array(edgeCount);
	const edgeCounts = new Int32Array(edgeCount);
	const edgeTraj = new Uint8Array(edgeCount);
	let ei = 0;
	for (const e of edgeMap.values()) {
		edgeSrc[ei] = e.src;
		edgeDst[ei] = e.dst;
		edgeFirstStep[ei] = e.first;
		edgeCounts[ei] = e.count;
		edgeTraj[ei] = e.traj;
		ei++;
	}

	// Neighbor-only nodes (indices ≥ nodeCountAtTraj) seed on a small
	// deterministic ring around their anchor's stalk base.
	const initX = new Float32Array(nodeCount);
	const initY = new Float32Array(nodeCount);
	const ga = Math.PI * (3 - Math.sqrt(5));
	for (let ni = 0; ni < nodeCount; ni++) {
		const base = anchorOf[ni]!;
		if (base < 0) {
			initX[ni] = gx[ni]!;
			initY[ni] = gy[ni]!;
		} else {
			const a = ni * ga;
			const r = spacing * (0.3 + 0.4 * fract(0.618034 * (ni + 1)));
			initX[ni] = gx[base]! + r * Math.cos(a);
			initY[ni] = gy[base]! + r * Math.sin(a);
		}
	}

	return {
		nodeCount,
		T,
		ids: Int32Array.from(ids),
		trajStep: Int32Array.from(trajSteps),
		revealStep: Int32Array.from(reveals),
		initX,
		initY,
		labels: ids.map((id) => (id === maskId ? '[MASK]' : labelOf(id))),
		edgeSrc,
		edgeDst,
		edgeFirstStep,
		edgeCount: edgeCounts,
		edgeTraj,
		hasNeighborhood,
		truncated,
	};
}

/**
 * Token id → node index for a built union graph. First index wins for
 * duplicate ids (ids are unique per node, so this is defensive).
 */
export function idToNodeMap(ids: Int32Array): Map<number, number> {
	const m = new Map<number, number>();
	for (let i = 0; i < ids.length; i++) {
		const id = ids[i]!;
		if (!m.has(id)) m.set(id, i);
	}
	return m;
}

/**
 * Occupancy of each node at step $t$: how many sequence positions
 * currently hold the node's token. Unmapped ids are ignored.
 */
export function occupancyAt(
	row: Int32Array,
	idToNode: Map<number, number>,
	nodeCount: number,
): Int32Array {
	const counts = new Int32Array(nodeCount);
	for (let i = 0; i < row.length; i++) {
		const ni = idToNode.get(row[i]!);
		if (ni !== undefined) counts[ni]!++;
	}
	return counts;
}
