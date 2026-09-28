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
	/** Ideal edge (spring rest) length for a small graph. Scaled down
	 *  automatically as $L \cdot \sqrt{n_0 / n}$ for larger graphs so the
	 *  layout keeps fitting the viewport. Default 60. */
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
		iterations = 300,
		repulsion = 3000,
		spring = 0.05,
		centering = 0.05,
	} = opts;

	const margin = 24;
	const cx = width / 2;
	const cy = height / 2;
	const n = nodes.length;

	const pos = new Map<string, { x: number; y: number }>();
	if (n === 0) return pos;

	// Scale the ideal length with graph size (Fruchterman–Reingold): the
	// reference density is ~10 nodes; without this, large graphs push
	// everything to the viewport boundary and pin it there.
	const n0 = 10;
	const ideal = (opts.idealLength ?? 60) * Math.sqrt(n0 / n);

	// Deterministic init: nodes on a circle whose radius grows with the
	// node count so the initial spacing stays near the ideal length.
	const r = Math.max(
		Math.min(width, height) / 3,
		(ideal * n) / (2 * Math.PI),
		Math.min(width, height) / 2.2,
	);
	for (let i = 0; i < n; i++) {
		const a = (2 * Math.PI * i) / n;
		pos.set(nodes[i]!.key, { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
	}

	// Index edges for the spring pass.
	const edgeIdx = edges
		.map((e) => ({
			fromKey: e.from,
			toKey: e.to,
			fromPos: pos.get(e.from),
			toPos: pos.get(e.to),
			w: e.weight ?? 0.5,
		}))
		.filter((e) => e.fromPos && e.toPos);

	const min = margin;
	const maxX = width - margin;
	const maxY = height - margin;

	// Per-node displacement cap (applied to the *total* per-iteration
	// displacement, not per force): prevents the aggregate repulsion from
	// many neighbors flinging nodes to the viewport edges in a single
	// iteration (where the clamp then pins them).
	const maxDisp = ideal;

	// Repulsion scales with the ideal length (Fruchterman–Reingold $k^2$):
	// constant repulsion across graph sizes over-pushes large graphs to
	// the boundary.
	const repulseK = repulsion * ideal * ideal * (1 / 1200);

	// Repulsion cutoff: full strength below `ideal`, linearly decaying to
	// zero at 2.5× `ideal`. Short-range separation stays strong while
	// long-range drift (which the boundary force must contain) stays weak.
	const cutoff = 2.5 * ideal;

	for (let iter = 0; iter < iterations; iter++) {
		// Damping: strong early movement, gentle settle.
		const damp = 1 - iter / iterations;

		// Accumulate forces into per-node displacement vectors, then apply
		// with a total-magnitude cap (Fruchterman–Reingold temperature).
		const disp = new Map<string, { x: number; y: number }>();
		for (const node of nodes) disp.set(node.key, { x: 0, y: 0 });

		// Repulsion (all pairs). Force is $f = k / d$ (not $k/d^2$), so
		// close pairs push apart firmly without the singularity at
		// $d \to 0$ dominating the whole layout.
		for (let i = 0; i < n; i++) {
			for (let j = i + 1; j < n; j++) {
				const a = disp.get(nodes[i]!.key)!;
				const b = disp.get(nodes[j]!.key)!;
				const pa = pos.get(nodes[i]!.key)!;
				const pb = pos.get(nodes[j]!.key)!;
				let dx = pa.x - pb.x;
				let dy = pa.y - pb.y;
				let d2 = dx * dx + dy * dy;
				if (d2 < 1e-6) {
					// Jitter deterministically to break overlaps.
					dx = 0.5;
					dy = 0.5;
					d2 = 0.5;
				}
				const d = Math.sqrt(d2);
				if (d > cutoff) continue;
				const f = (repulseK * damp) / d;
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
			const da = disp.get(e.fromKey)!;
			const db = disp.get(e.toKey)!;
			const dx = e.toPos!.x - e.fromPos!.x;
			const dy = e.toPos!.y - e.fromPos!.y;
			const d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
			const f = (spring * e.w * damp * (d - ideal)) / d;
			da.x += f * dx;
			da.y += f * dy;
			db.x -= f * dx;
			db.y -= f * dy;
		}

		// Apply capped displacement.
		for (const node of nodes) {
			const p = pos.get(node.key)!;
			const d = disp.get(node.key)!;
			const mag = Math.hypot(d.x, d.y);
			if (mag > maxDisp) {
				d.x = (d.x / mag) * maxDisp;
				d.y = (d.y / mag) * maxDisp;
			}
			p.x += d.x;
			p.y += d.y;
		}

		// Centering pull plus a soft boundary force. The centering keeps
		// the cluster compact (strong enough to counter aggregate
		// repulsion); the boundary force is a last-resort containment.
		const band = ideal / 2; // soft boundary band width
		const push = 1.0; // boundary spring strength (per unit overshoot)
		for (const p of pos.values()) {
			p.x += (cx - p.x) * centering * damp;
			p.y += (cy - p.y) * centering * damp;
			if (p.x < min + band) p.x += (min + band - p.x) * push * damp;
			if (p.x > maxX - band) p.x -= (p.x - (maxX - band)) * push * damp;
			if (p.y < min + band) p.y += (min + band - p.y) * push * damp;
			if (p.y > maxY - band) p.y -= (p.y - (maxY - band)) * push * damp;
		}
	}

	// Final clamp into the viewport.
	for (const p of pos.values()) {
		p.x = Math.max(min, Math.min(maxX, p.x));
		p.y = Math.max(min, Math.min(maxY, p.y));
	}

	return pos;
}
