/**
 * Deterministic force-directed layout for small graphs.
 *
 * Pure function: no DOM, no randomness (initial positions derive from the
 * node index on a circle, so the same graph always yields the same
 * layout). Intended for the hover tooltip now, and reusable for a future
 * all-trajectories view (move into a worker if graphs grow).
 *
 * Forces per iteration:
 * - Pairwise repulsion $\propto 1/d^2$ between all node pairs.
 * - Spring attraction along edges $\propto (d - L)$, weighted by the edge
 *   weight so strongly-connected tokens pull closer.
 * - Mild centering pull toward the origin.
 * - Positions clamped to the viewport box each iteration.
 */

/** A layout node: unique key plus optional fixed weight. */
export interface LayoutNode {
	/** Unique key (e.g. token id or `t${step}`). */
	key: string;
}

/** A layout edge between two node keys. */
export interface LayoutEdge {
	from: string;
	to: string;
	/** Spring strength in $[0, 1]$; 0 uses the default. */
	weight?: number;
}

export interface ForceLayoutOptions {
	/** Viewport width. */
	width: number;
	/** Viewport height. */
	height: number;
	/** Ideal edge (spring rest) length. Default 60. */
	idealLength?: number;
	/** Number of simulation iterations. Default 300. */
	iterations?: number;
	/** Repulsion strength. Default 3000. */
	repulsion?: number;
	/** Spring strength. Default 0.05. */
	spring?: number;
	/** Centering pull strength. Default 0.01. */
	centering?: number;
}

/**
 * Compute force-directed positions for `nodes`.
 *
 * @returns A map from node key to position, clamped inside the viewport
 *   with a small margin.
 */
export function computeForceLayout(
	nodes: readonly LayoutNode[],
	edges: readonly LayoutEdge[],
	opts: ForceLayoutOptions,
): Map<string, { x: number; y: number }> {
	const {
		width,
		height,
		idealLength = 60,
		iterations = 300,
		repulsion = 3000,
		spring = 0.05,
		centering = 0.01,
	} = opts;

	const margin = 24;
	const cx = width / 2;
	const cy = height / 2;
	const n = nodes.length;

	const pos = new Map<string, { x: number; y: number }>();
	if (n === 0) return pos;

	// Deterministic init: nodes on a circle of radius ~min(w,h)/3.
	const r = Math.min(width, height) / 3;
	for (let i = 0; i < n; i++) {
		const a = (2 * Math.PI * i) / n;
		pos.set(nodes[i]!.key, { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
	}

	// Index edges for the spring pass.
	const edgeIdx = edges
		.map((e) => ({ from: pos.get(e.from), to: pos.get(e.to), w: e.weight ?? 0.5 }))
		.filter((e) => e.from && e.to);

	const min = margin;
	const maxX = width - margin;
	const maxY = height - margin;

	for (let iter = 0; iter < iterations; iter++) {
		// Damping: strong early movement, gentle settle.
		const damp = 1 - iter / iterations;

		// Repulsion (all pairs).
		for (let i = 0; i < n; i++) {
			for (let j = i + 1; j < n; j++) {
				const a = pos.get(nodes[i]!.key)!;
				const b = pos.get(nodes[j]!.key)!;
				let dx = a.x - b.x;
				let dy = a.y - b.y;
				let d2 = dx * dx + dy * dy;
				if (d2 < 1e-6) {
					// Jitter deterministically to break overlaps.
					dx = 0.5;
					dy = 0.5;
					d2 = 0.5;
				}
				const f = (repulsion * damp) / d2;
				const d = Math.sqrt(d2);
				const fx = (f * dx) / d;
				const fy = (f * dy) / d;
				a.x += fx;
				a.y += fy;
				b.x -= fx;
				b.y -= fy;
			}
		}

		// Springs (edges).
		for (const e of edgeIdx) {
			const a = e.from!;
			const b = e.to!;
			const dx = b.x - a.x;
			const dy = b.y - a.y;
			const d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
			const f = (spring * e.w * damp * (d - idealLength)) / d;
			a.x += f * dx;
			a.y += f * dy;
			b.x -= f * dx;
			b.y -= f * dy;
		}

		// Centering + clamp.
		for (const p of pos.values()) {
			p.x += (cx - p.x) * centering * damp;
			p.y += (cy - p.y) * centering * damp;
			p.x = Math.max(min, Math.min(maxX, p.x));
			p.y = Math.max(min, Math.min(maxY, p.y));
		}
	}

	return pos;
}
