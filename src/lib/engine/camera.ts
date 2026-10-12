/**
 * Pan/zoom camera math for the full-graph canvas view.
 *
 * Pure functions over a plain camera state:
 * - `x`, `y`: world coordinates at the **center** of the viewport.
 * - `zoom`: screen pixels per world unit.
 *
 * No DOM, no state — the component owns the camera object and applies
 * these helpers.
 */

/** Camera state: world point at the viewport center + pixels-per-unit. */
export interface Camera {
	x: number;
	y: number;
	zoom: number;
}

/** Viewport size in screen pixels. */
export interface Viewport {
	width: number;
	height: number;
}

/** Bounds of a world-space region (`minX > maxX` etc. for empty). */
export interface WorldBounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

/** Default zoom limits (screen px per world unit). */
export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 20;

/** Convert world coordinates to screen (canvas) coordinates. */
export function worldToScreen(
	cam: Camera,
	wx: number,
	wy: number,
	vp: Viewport,
): { x: number; y: number } {
	return {
		x: (wx - cam.x) * cam.zoom + vp.width / 2,
		y: (wy - cam.y) * cam.zoom + vp.height / 2,
	};
}

/** Convert screen (canvas) coordinates to world coordinates. */
export function screenToWorld(
	cam: Camera,
	sx: number,
	sy: number,
	vp: Viewport,
): { x: number; y: number } {
	return {
		x: (sx - vp.width / 2) / cam.zoom + cam.x,
		y: (sy - vp.height / 2) / cam.zoom + cam.y,
	};
}

/** Clamp a zoom factor into $[z_{\min}, z_{\max}]$. */
export function clampZoom(zoom: number, min = MIN_ZOOM, max = MAX_ZOOM): number {
	return Math.max(min, Math.min(max, zoom));
}

/**
 * Zoom by `factor` about the screen point `(sx, sy)`, keeping that
 * point fixed in place. Returns the new camera (input unchanged).
 */
export function zoomAt(
	cam: Camera,
	factor: number,
	sx: number,
	sy: number,
	vp: Viewport,
	min = MIN_ZOOM,
	max = MAX_ZOOM,
): Camera {
	const zoom = clampZoom(cam.zoom * factor, min, max);
	const world = screenToWorld(cam, sx, sy, vp);
	return {
		zoom,
		x: world.x - (sx - vp.width / 2) / zoom,
		y: world.y - (sy - vp.height / 2) / zoom,
	};
}

/** Pan by a screen-space delta (world shifts opposite). */
export function panBy(cam: Camera, dxScreen: number, dyScreen: number): Camera {
	return { ...cam, x: cam.x - dxScreen / cam.zoom, y: cam.y - dyScreen / cam.zoom };
}

/**
 * Fit a world-space region into the viewport with `padding` screen
 * pixels, centered. Returns a new camera.
 */
export function fitBounds(bounds: WorldBounds, vp: Viewport, padding = 40, max = MAX_ZOOM): Camera {
	const w = bounds.maxX - bounds.minX;
	const h = bounds.maxY - bounds.minY;
	if (!(w >= 0) || !(h >= 0) || (w === 0 && h === 0)) {
		return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2, zoom: 1 };
	}
	const zoom = clampZoom(
		Math.min((vp.width - 2 * padding) / w, (vp.height - 2 * padding) / h),
		MIN_ZOOM,
		max,
	);
	return {
		x: (bounds.minX + bounds.maxX) / 2,
		y: (bounds.minY + bounds.maxY) / 2,
		zoom,
	};
}

/**
 * Compute the bounding box of a set of positions (as interleaved
 * Float32Array pairs or separate arrays). Empty inputs yield
 * `minX > maxX`.
 */
export function boundsOf(x: Float32Array, y: Float32Array): WorldBounds {
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	const n = Math.min(x.length, y.length);
	for (let i = 0; i < n; i++) {
		if (x[i]! < minX) minX = x[i]!;
		if (x[i]! > maxX) maxX = x[i]!;
		if (y[i]! < minY) minY = y[i]!;
		if (y[i]! > maxY) maxY = y[i]!;
	}
	return { minX, minY, maxX, maxY };
}
