import { describe, it, expect } from 'vitest';
import { computeForceLayout } from './force-layout.js';

const opts = { width: 340, height: 220 };

describe('computeForceLayout', () => {
	it('returns a position for every node', () => {
		const nodes = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
		const pos = computeForceLayout(nodes, [], opts);
		expect(pos.size).toBe(3);
		expect(pos.has('a')).toBe(true);
		expect(pos.has('b')).toBe(true);
		expect(pos.has('c')).toBe(true);
	});

	it('is deterministic for the same input', () => {
		const nodes = [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }];
		const edges = [
			{ from: 'a', to: 'b' },
			{ from: 'b', to: 'c' },
			{ from: 'c', to: 'd' },
		];
		const p1 = computeForceLayout(nodes, edges, opts);
		const p2 = computeForceLayout(nodes, edges, opts);
		expect(p1.get('a')).toEqual(p2.get('a'));
		expect(p1.get('d')).toEqual(p2.get('d'));
	});

	it('clamps all positions inside the viewport', () => {
		const nodes = Array.from({ length: 30 }, (_, i) => ({ key: `n${i}` }));
		const edges = Array.from({ length: 40 }, (_, i) => ({
			from: `n${i % 30}`,
			to: `n${(i * 7 + 3) % 30}`,
		}));
		const pos = computeForceLayout(nodes, edges, opts);
		for (const p of pos.values()) {
			expect(p.x).toBeGreaterThanOrEqual(24);
			expect(p.x).toBeLessThanOrEqual(340 - 24);
			expect(p.y).toBeGreaterThanOrEqual(24);
			expect(p.y).toBeLessThanOrEqual(220 - 24);
		}
	});

	it('pulls connected nodes closer than unconnected ones', () => {
		const nodes = [{ key: 'a' }, { key: 'b' }, { key: 'x' }, { key: 'y' }];
		const pos = computeForceLayout(nodes, [{ from: 'a', to: 'b', weight: 1 }], opts);
		const d = (k1: string, k2: string) => {
			const p1 = pos.get(k1)!;
			const p2 = pos.get(k2)!;
			return Math.hypot(p1.x - p2.x, p1.y - p2.y);
		};
		expect(d('a', 'b')).toBeLessThan(d('x', 'y'));
	});

	it('handles a single node', () => {
		const pos = computeForceLayout([{ key: 'only' }], [], opts);
		expect(pos.get('only')).toBeDefined();
	});

	it('handles an empty node list', () => {
		expect(computeForceLayout([], [], opts).size).toBe(0);
	});

	it('separates overlapping nodes', () => {
		// Many nodes with no edges: repulsion should spread them out.
		const nodes = Array.from({ length: 12 }, (_, i) => ({ key: `n${i}` }));
		const pos = computeForceLayout(nodes, [], opts);
		const keys = [...pos.keys()];
		let minDist = Infinity;
		for (let i = 0; i < keys.length; i++) {
			for (let j = i + 1; j < keys.length; j++) {
				const a = pos.get(keys[i]!)!;
				const b = pos.get(keys[j]!)!;
				minDist = Math.min(minDist, Math.hypot(a.x - b.x, a.y - b.y));
			}
		}
		expect(minDist).toBeGreaterThan(5);
	});
});
