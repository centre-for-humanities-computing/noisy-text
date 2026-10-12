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

// ---- Large graphs (full-graph view) ----

/**
 * The ideal edge length used by `computeForceLayoutLarge` for a graph
 * of `n` nodes: scaled down mildly from `baseIdeal` as $L \cdot
 * (10/n)^{0.3}$ (with a floor of 2). Exported so callers building
 * initial positions (the union-graph builder's seed grid) use the
 * same scale as the layout.
 */
export function largeIdealLength(n: number, baseIdeal = 60): number {
	return Math.max(2, baseIdeal * Math.pow(10 / Math.max(10, n), 0.3));
}

/** Options for `computeForceLayoutLarge`. */
export interface LargeLayoutOptions {
	/** Base ideal edge length. Scaled down as $L \cdot (n_0/n)^{0.3}$. Default 60. */
	idealLength?: number;
	/** Simulation iterations for this call. Default 300. */
	iterations?: number;
	/** Damping schedule length for the hold-then-cool schedule (see
	 *  below). Defaults to `iterationOffset + iterations`. */
	dampTotal?: number;
	/** Iteration offset into the damping schedule (for chunked runs). Default 0. */
	iterationOffset?: number;
	/** Repulsion strength: the per-pair coefficient is $c = \text{repulsion} \cdot L^3 / 7200$
	 *  (with $L$ the ideal length), applied with $1/d^2$ falloff. Default 15. */
	repulsion?: number;
	/** Spring strength: displacement along an edge is
	 *  $\text{spring} \cdot (d - L)$ (Fruchterman–Reingold style, proportional to
	 *  extension). Default 0.1. */
	spring?: number;
	/**
	 * Per-iteration displacement cap as a multiple of the ideal length,
	 * annealed: the cap runs from `maxDispScale` (early, damp $= 1$)
	 * down to $\frac{2}{3}$ of it (late, damp $= 0$), so long init edges
	 * contract fast and the layout settles calmly. Default 10.
	 */
	maxDispScale?: number;
	/**
	 * Initial positions to continue from (e.g. for chunked, progress-
	 * reporting runs). When omitted, nodes start on a deterministic
	 * phyllotaxis spiral.
	 */
	initial?: { x: Float32Array; y: Float32Array } | null;
}

/**
 * Force-directed layout for large graphs (thousands of nodes), used by
 * the full-graph view. Same overall scheme as `computeForceLayout`
 * (repulsion with a $2.5L$ cutoff, weighted springs, centering, capped
 * displacement) with differences that matter at scale:
 *
 * - Repulsion is accelerated by a uniform spatial hash grid (cell size
 *   = the repulsion cutoff), so each iteration is $O(n + E)$ instead
 *   of $O(n^2)$.
 * - Springs are proportional to extension, $\Delta \propto (d - L)$, and
 *   repulsion falls off as $1/d^2$ with coefficient $\propto L^3$ — the
 *   small variant uses $1/d$ repulsion with a hard viewport clamp and
 *   $1/d$-normalized springs, which does not transfer to unbounded
 *   world space (long-range contraction would take thousands of
 *   iterations).
 * - There is no viewport clamp and no centering force: positions live
 *   in unbounded world space, the camera fits the result, and the
 *   initial positions (from the union-graph growth scan) already place
 *   components where they belong. Nothing pushes outward except
 *   short-range repulsion, so nothing needs containing.
 *
 * Pure and deterministic: same inputs (including `initial`) always
 * produce the same positions. The worker runs it in chunks by passing
 * the previous result back as `initial` plus the matching
 * `iterationOffset`/`dampTotal`.
 */
export function computeForceLayoutLarge(
	nodeCount: number,
	edgeSrc: Int32Array,
	edgeDst: Int32Array,
	edgeWeight: Float32Array | null,
	opts: LargeLayoutOptions = {},
): { x: Float32Array; y: Float32Array } {
	const n = nodeCount;
	const x = new Float32Array(n);
	const y = new Float32Array(n);
	if (n === 0) return { x, y };

	const baseIdeal = opts.idealLength ?? 60;
	const ideal = largeIdealLength(n, baseIdeal);
	const iterations = opts.iterations ?? 300;
	const iterationOffset = opts.iterationOffset ?? 0;
	const dampTotal = opts.dampTotal ?? iterationOffset + iterations;
	const spring = opts.spring ?? 0.1;
	const repulsion = opts.repulsion ?? 15;
	const maxDispScale = opts.maxDispScale ?? 10;

	// Initial positions: continue, or deterministic phyllotaxis spiral.
	if (opts.initial && opts.initial.x.length === n) {
		x.set(opts.initial.x);
		y.set(opts.initial.y);
	} else {
		const ga = Math.PI * (3 - Math.sqrt(5));
		const spacing = ideal * 1.2;
		for (let i = 0; i < n; i++) {
			const r = spacing * Math.sqrt(i + 0.5);
			const a = i * ga;
			x[i] = r * Math.cos(a);
			y[i] = r * Math.sin(a);
		}
	}

	// Force scalings. The repulsion coefficient $\propto L^3$ balances
	// the extension-proportional springs so edges settle near $1.3L$
	// (with ~12 nodes inside the $2.5L$ cutoff at that spacing).
	const repulseK = (repulsion * ideal * ideal * ideal) / 7200;
	const cutoff = 2.5 * ideal;
	const cutoff2 = cutoff * cutoff;
	const maxDisp = ideal * maxDispScale;

	// Spatial hash grid: chained buckets, table a power of two ≥ 2n.
	// Allocated once; `head` is refilled (with -1) every iteration.
	let table = 16;
	while (table < 2 * n) table *= 2;
	const hashMask = table - 1;
	const head = new Int32Array(table);
	const next = new Int32Array(n);
	const dispX = new Float32Array(n);
	const dispY = new Float32Array(n);
	const cellX = new Int32Array(n);
	const cellY = new Int32Array(n);

	/** Hash a grid cell (non-negative coords, offset by the current
	 *  bounds origin) to a bucket index. Hash collisions are harmless:
	 *  cells are compared explicitly before applying forces. */
	function bucket(cx: number, cy: number): number {
		let h = (cx * 73856093) ^ (cy * 19349663);
		h = (h ^ (h >>> 16)) & hashMask;
		return h;
	}

	for (let iter = 0; iter < iterations; iter++) {
		// Hold-then-cool schedule: full strength while long-range
		// contraction happens (displacement is cap-limited anyway, so a
		// strong early phase is stable), then linear cooling so the
		// layout settles instead of diffusing. A linear 1 − i/n schedule
		// spends most of the run too weak to contract wide inits.
		const g = iterationOffset + iter;
		const hold = dampTotal * 0.75;
		const damp = g >= hold ? Math.max(0, 1 - (g - hold) / Math.max(1, dampTotal - hold)) : 1;

		// Bounds → non-negative cell coords for hashing.
		let minX = Infinity;
		let minY = Infinity;
		for (let i = 0; i < n; i++) {
			if (x[i]! < minX) minX = x[i]!;
			if (y[i]! < minY) minY = y[i]!;
		}
		const ox = Math.floor(minX / cutoff) * cutoff;
		const oy = Math.floor(minY / cutoff) * cutoff;

		// Fill the grid and cache cell coords.
		head.fill(-1);
		for (let i = 0; i < n; i++) {
			const cx = Math.floor((x[i]! - ox) / cutoff);
			const cy = Math.floor((y[i]! - oy) / cutoff);
			cellX[i] = cx;
			cellY[i] = cy;
			const b = bucket(cx, cy);
			next[i] = head[b]!;
			head[b] = i;
		}

		// Repulsion: for each node, scan the 3×3 cell neighborhood. A
		// pair is processed once (the outer index is the larger). A node
		// within `cutoff` always lies in an adjacent cell because the
		// cell size equals `cutoff`.
		dispX.fill(0);
		dispY.fill(0);
		for (let i = 0; i < n; i++) {
			const cxi = cellX[i]!;
			const cyi = cellY[i]!;
			const xi = x[i]!;
			const yi = y[i]!;
			let fxAcc = 0;
			let fyAcc = 0;
			for (let gx = -1; gx <= 1; gx++) {
				for (let gy = -1; gy <= 1; gy++) {
					const b = bucket(cxi + gx, cyi + gy);
					for (let j = head[b]!; j !== -1; j = next[j]!) {
						if (j >= i) continue; // pair handled (or self)
						if (cellX[j] !== cxi + gx || cellY[j] !== cyi + gy) continue; // hash collision
						let dx = xi - x[j]!;
						let dy = yi - y[j]!;
						let d2 = dx * dx + dy * dy;
						if (d2 > cutoff2) continue;
						if (d2 < 1e-6) {
							// Deterministic jitter to break overlaps.
							const a = i * 2.399963;
							dx = Math.cos(a) * 0.01;
							dy = Math.sin(a) * 0.01;
							d2 = 1e-4;
						}
						const d = Math.sqrt(d2);
						// $1/d^2$ falloff: force vector $\propto \vec{d}/d^3$.
						const f = (repulseK * damp) / d2;
						const fx = (f * dx) / d;
						const fy = (f * dy) / d;
						fxAcc += fx;
						fyAcc += fy;
						dispX[j] = dispX[j]! - fx;
						dispY[j] = dispY[j]! - fy;
					}
				}
			}
			dispX[i] = dispX[i]! + fxAcc;
			dispY[i] = dispY[i]! + fyAcc;
		}

		// Springs (edges). Extension-proportional displacement:
		// $|\Delta| = \text{spring} \cdot w \cdot \text{damp} \cdot (d - L)$.
		for (let e = 0; e < edgeSrc.length; e++) {
			const a = edgeSrc[e]!;
			const b = edgeDst[e]!;
			const w = edgeWeight ? edgeWeight[e]! : 0.5;
			const dx = x[b]! - x[a]!;
			const dy = y[b]! - y[a]!;
			const d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
			const f = (spring * w * damp * (d - ideal)) / d;
			dispX[a] = dispX[a]! + f * dx;
			dispY[a] = dispY[a]! + f * dy;
			dispX[b] = dispX[b]! - f * dx;
			dispY[b] = dispY[b]! - f * dy;
		}

		// Apply capped displacement (annealed cap).
		const cap = maxDisp * (0.66 + 0.34 * damp);
		for (let i = 0; i < n; i++) {
			const dx = dispX[i]!;
			const dy = dispY[i]!;
			const mag = Math.sqrt(dx * dx + dy * dy);
			if (mag > cap) {
				x[i] = x[i]! + (dx / mag) * cap;
				y[i] = y[i]! + (dy / mag) * cap;
			} else {
				x[i] = x[i]! + dx;
				y[i] = y[i]! + dy;
			}
		}
	}

	return { x, y };
}
