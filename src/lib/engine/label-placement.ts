/**
 * Screen-space label placement for the graph view.
 *
 * Candidates are tried in priority order (lower index first). A candidate is
 * accepted when its anchor lies on the canvas and its box keeps `gap` px clear
 * of every box accepted before it. A uniform grid over the canvas limits each
 * check to the boxes near the candidate.
 */

export interface LabelPlacementOptions {
	/** Canvas size in CSS px. Anchors outside it are skipped. */
	width: number;
	height: number;
	/** Height of every label box, px. */
	labelHeight: number;
	/** Stop once this many labels are accepted. */
	maxLabels: number;
	/** Minimum clear space between accepted boxes, px. */
	gap: number;
	/** Side length of the overlap-index grid cells, px. */
	cell: number;
}

/**
 * Greedy placement. Candidate `k` (for `k < count`) is a label centred on
 * `(x[k], y[k])` with width `w[k]`. Returns the indices of the accepted
 * candidates, in priority order.
 */
export function placeLabels(
	count: number,
	x: ArrayLike<number>,
	y: ArrayLike<number>,
	w: ArrayLike<number>,
	opts: LabelPlacementOptions,
): number[] {
	const { width, height, labelHeight, maxLabels, gap, cell } = opts;
	const cols = Math.max(1, Math.ceil(width / cell));
	const rows = Math.max(1, Math.ceil(height / cell));
	const colOf = (px: number): number => Math.min(cols - 1, Math.max(0, Math.floor(px / cell)));
	const rowOf = (py: number): number => Math.min(rows - 1, Math.max(0, Math.floor(py / cell)));
	const halfH = labelHeight / 2;

	// Accepted boxes (by acceptance order) and a grid index from cell number to
	// the accepted boxes that touch that cell.
	const left: number[] = [];
	const right: number[] = [];
	const top: number[] = [];
	const bottom: number[] = [];
	const cells = new Map<number, number[]>();
	const accepted: number[] = [];

	/** True if the box comes within `gap` of an accepted box. */
	const blocked = (l: number, r: number, t: number, b: number): boolean => {
		// A conflicting box intersects this box grown by `gap`, so it touches
		// one of the cells covered by the grown box.
		for (let row = rowOf(t - gap); row <= rowOf(b + gap); row++) {
			for (let col = colOf(l - gap); col <= colOf(r + gap); col++) {
				const bucket = cells.get(row * cols + col);
				if (!bucket) continue;
				for (const j of bucket) {
					if (
						l < right[j]! + gap &&
						left[j]! < r + gap &&
						t < bottom[j]! + gap &&
						top[j]! < b + gap
					) {
						return true;
					}
				}
			}
		}
		return false;
	};

	for (let k = 0; k < count && accepted.length < maxLabels; k++) {
		const cx = x[k]!;
		const cy = y[k]!;
		if (cx < 0 || cx > width || cy < 0 || cy > height) continue;
		const hw = w[k]! / 2;
		const l = cx - hw;
		const r = cx + hw;
		const t = cy - halfH;
		const b = cy + halfH;
		if (blocked(l, r, t, b)) continue;

		const j = left.length;
		left.push(l);
		right.push(r);
		top.push(t);
		bottom.push(b);
		accepted.push(k);
		for (let row = rowOf(t); row <= rowOf(b); row++) {
			for (let col = colOf(l); col <= colOf(r); col++) {
				const key = row * cols + col;
				const bucket = cells.get(key);
				if (bucket) bucket.push(j);
				else cells.set(key, [j]);
			}
		}
	}
	return accepted;
}
