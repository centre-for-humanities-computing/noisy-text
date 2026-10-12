import { describe, it, expect } from 'vitest';
import {
	worldToScreen,
	screenToWorld,
	zoomAt,
	panBy,
	fitBounds,
	boundsOf,
	clampZoom,
} from './camera.js';

const vp = { width: 800, height: 600 };
const cam = { x: 100, y: -50, zoom: 2 };

describe('worldToScreen / screenToWorld', () => {
	it('round-trips', () => {
		for (const [wx, wy] of [
			[100, -50],
			[0, 0],
			[-123.5, 88.25],
		] as const) {
			const s = worldToScreen(cam, wx, wy, vp);
			const w = screenToWorld(cam, s.x, s.y, vp);
			expect(w.x).toBeCloseTo(wx, 10);
			expect(w.y).toBeCloseTo(wy, 10);
		}
	});

	it('centers the camera point in the viewport', () => {
		const s = worldToScreen(cam, cam.x, cam.y, vp);
		expect(s.x).toBe(400);
		expect(s.y).toBe(300);
	});
});

describe('zoomAt', () => {
	it('keeps the anchor point fixed', () => {
		const sx = 200;
		const sy = 150;
		const before = screenToWorld(cam, sx, sy, vp);
		const next = zoomAt(cam, 1.5, sx, sy, vp);
		const after = screenToWorld(next, sx, sy, vp);
		expect(after.x).toBeCloseTo(before.x, 8);
		expect(after.y).toBeCloseTo(before.y, 8);
		expect(next.zoom).toBeCloseTo(3, 10);
	});

	it('clamps at the max zoom but still zooms about the anchor', () => {
		const next = zoomAt(cam, 1000, 400, 300, vp, 0.02, 20);
		expect(next.zoom).toBe(20);
	});

	it('clamps at the min zoom', () => {
		const next = zoomAt(cam, 1e-9, 0, 0, vp, 0.02, 20);
		expect(next.zoom).toBe(0.02);
	});
});

describe('panBy', () => {
	it('shifts the world opposite to the screen delta', () => {
		const next = panBy(cam, 100, 50);
		// Dragging right by 100 px moves the camera left in world space.
		expect(next.x).toBeCloseTo(cam.x - 100 / 2, 10);
		expect(next.y).toBeCloseTo(cam.y - 50 / 2, 10);
	});
});

describe('fitBounds', () => {
	it('fits the region with padding and centers it', () => {
		const bounds = { minX: 0, minY: 0, maxX: 400, maxY: 300 };
		const next = fitBounds(bounds, vp, 40);
		expect(next.x).toBe(200);
		expect(next.y).toBe(150);
		// Height-limited: (600 − 80) / 300 = 1.7333.
		expect(next.zoom).toBeCloseTo(1.7333333, 6);
	});

	it('respects the max zoom for tiny regions', () => {
		const bounds = { minX: 0, minY: 0, maxX: 0.001, maxY: 0.001 };
		const next = fitBounds(bounds, vp, 40);
		expect(next.zoom).toBe(20);
	});

	it('falls back to zoom 1 for degenerate (empty) bounds', () => {
		const next = fitBounds({ minX: 5, minY: 5, maxX: -1, maxY: -1 }, vp, 40);
		expect(next.zoom).toBe(1);
		expect(next.x).toBe(2);
	});
});

describe('boundsOf', () => {
	it('computes the bounding box', () => {
		const b = boundsOf(new Float32Array([1, -3, 2]), new Float32Array([4, 5, -7]));
		expect(b).toEqual({ minX: -3, minY: -7, maxX: 2, maxY: 5 });
	});
});

describe('clampZoom', () => {
	it('clamps into the default range', () => {
		expect(clampZoom(0.001)).toBe(0.02);
		expect(clampZoom(100)).toBe(20);
		expect(clampZoom(1)).toBe(1);
	});
});
