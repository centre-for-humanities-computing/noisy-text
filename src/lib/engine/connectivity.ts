/**
 * Connectivity analysis for the neighbourhood graph (kNN or radius).
 *
 * A disconnected kNN graph means the walk cannot move between
 * components (barring the ergodicity floor $\varepsilon$), which
 * materially changes the noise process — clusters of tokens saturate
 * internally and never mix. This module reports the structure so the UI
 * can surface it (AC4 of issue #28).
 *
 * Union-find over the **neighbourhood** edges only (`edgeTraj[i] === 0`):
 * trajectory edges are the walked path, not part of the jump support.
 */

export interface ConnectivityReport {
	/** Number of connected components among nodes touched by any edge. */
	componentCount: number;
	/** Size of the largest component. */
	largestComponentSize: number;
	/** Number of nodes not incident to any neighbourhood edge. */
	isolatedCount: number;
	/** `true` when the neighbourhood graph has at most one component. */
	connected: boolean;
}

/**
 * Analyze connectivity of a graph given as parallel edge arrays.
 *
 * Nodes with no neighbourhood edges count as isolated and each form
 * their own component (so `componentCount` includes them); `connected`
 * is `componentCount <= 1`.
 *
 * @param nodeCount - Number of nodes (node indices in $[0, \mathrm{nodeCount})$).
 * @param edgeSrc - Edge source node indices.
 * @param edgeDst - Edge destination node indices.
 * @param edgeTraj - 1 for trajectory edges (ignored), 0 for neighbourhood edges.
 */
export function analyzeConnectivity(
	nodeCount: number,
	edgeSrc: Int32Array,
	edgeDst: Int32Array,
	edgeTraj: Uint8Array,
): ConnectivityReport {
	// Union-find with path halving + union by size.
	const parent = new Int32Array(nodeCount);
	const size = new Int32Array(nodeCount);
	for (let i = 0; i < nodeCount; i++) {
		parent[i] = i;
		size[i] = 1;
	}
	const find = (x: number): number => {
		while (parent[x] !== x) {
			parent[x] = parent[parent[x]!]!;
			x = parent[x]!;
		}
		return x;
	};

	const hasEdge = new Uint8Array(nodeCount);
	for (let e = 0; e < edgeSrc.length; e++) {
		if (edgeTraj[e] === 1) continue;
		const a = edgeSrc[e]!;
		const b = edgeDst[e]!;
		hasEdge[a] = 1;
		hasEdge[b] = 1;
		const ra = find(a);
		const rb = find(b);
		if (ra !== rb) {
			if (size[ra]! < size[rb]!) {
				parent[ra] = rb;
				size[rb] = size[rb]! + size[ra]!;
			} else {
				parent[rb] = ra;
				size[ra] = size[ra]! + size[rb]!;
			}
		}
	}

	// Component sizes keyed by root.
	const rootSize = new Map<number, number>();
	let isolated = 0;
	for (let i = 0; i < nodeCount; i++) {
		if (!hasEdge[i]) {
			isolated++;
			continue;
		}
		const r = find(i);
		rootSize.set(r, (rootSize.get(r) ?? 0) + 1);
	}
	// Isolated nodes are their own components.
	const componentCount = rootSize.size + isolated;
	let largest = 0;
	for (const s of rootSize.values()) {
		if (s > largest) largest = s;
	}
	if (isolated > largest) largest = isolated;

	return {
		componentCount,
		largestComponentSize: largest,
		isolatedCount: isolated,
		connected: componentCount <= 1,
	};
}
