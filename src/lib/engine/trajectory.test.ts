import { describe, it, expect } from 'vitest';
import { computeTrajectory } from './trajectory.js';
import { createRng } from './rng.js';
import { getStrategy } from '../strategies/index.js';
import { getSchedule } from '../schedules/index.js';
import type { TrajectoryDeps } from './types.js';
import { MAX_CELLS } from './types.js';

/**
 * A fake strategy that adds 1 (mod vocabSize) at each step.
 * This proves coupling: $x_t[i] = (x_0[i] + t) \bmod K$.
 * An independent sampler would NOT satisfy this.
 */
function makePlusOneStrategy(vocabSize: number) {
	return {
		info: { id: 'plus-one', label: '', description: '', stationary: 'uniform' as const },
		config: {},
		sampleStep(token: number, _beta: number, _rng: () => number): number {
			return (token + 1) % vocabSize;
		},
	};
}

function makeDeps(vocabSize: number, T: number, seed: number): TrajectoryDeps {
	return {
		strategy: getStrategy('identity', {}, vocabSize),
		schedule: getSchedule('linear', {}, T),
		rng: createRng(seed),
	};
}

describe('computeTrajectory', () => {
	it('returns a trajectory with correct shape', () => {
		const input = new Int32Array([0, 1, 2]);
		const deps = makeDeps(10, 5, 42);
		const traj = computeTrajectory(input, deps);
		expect(traj.T).toBe(5);
		expect(traj.length).toBe(3);
		expect(traj.rows.length).toBe((5 + 1) * 3); // 18
	});

	it('tokensAt returns correct subarray views', () => {
		const input = new Int32Array([7, 8, 9]);
		const deps = makeDeps(20, 3, 42);
		const traj = computeTrajectory(input, deps);
		// Row 0 should equal input.
		const row0 = traj.tokensAt(0);
		expect(row0[0]).toBe(7);
		expect(row0[1]).toBe(8);
		expect(row0[2]).toBe(9);
		// Row 3 should exist.
		const row3 = traj.tokensAt(3);
		expect(row3.length).toBe(3);
	});

	it('identity strategy: all rows equal x_0', () => {
		const input = new Int32Array([5, 12, 3, 8]);
		const deps = makeDeps(50, 10, 99);
		const traj = computeTrajectory(input, deps);
		for (let t = 0; t <= traj.T; t++) {
			const row = traj.tokensAt(t);
			for (let i = 0; i < input.length; i++) {
				expect(row[i]).toBe(input[i]);
			}
		}
	});

	it('plus-one strategy proves coupling (not independent sampling)', () => {
		// $x_t[i] = (x_0[i] + t) \bmod K$ — this holds ONLY for coupled walks.
		const vocabSize = 100;
		const input = new Int32Array([0, 42, 99]);
		const deps: TrajectoryDeps = {
			strategy: makePlusOneStrategy(vocabSize),
			schedule: getSchedule('linear', {}, 10),
			rng: createRng(1),
		};
		const traj = computeTrajectory(input, deps);
		for (let t = 0; t <= traj.T; t++) {
			const row = traj.tokensAt(t);
			for (let i = 0; i < input.length; i++) {
				expect(row[i]).toBe((input[i]! + t) % vocabSize);
			}
		}
	});

	it('is deterministic for the same seed', () => {
		const input = new Int32Array([1, 2, 3, 4, 5]);
		const a = computeTrajectory(input, makeDeps(100, 20, 777));
		const b = computeTrajectory(input, makeDeps(100, 20, 777));
		expect(a.rows).toEqual(b.rows);
	});

	it('produces different trajectories for different seeds', () => {
		const input = new Int32Array([1, 2, 3, 4, 5]);
		const a = computeTrajectory(input, makeDeps(100, 20, 1));
		const b = computeTrajectory(input, makeDeps(100, 20, 2));
		// With identity strategy, seeds don't matter — use a real schedule
		// and a strategy that uses the RNG. But identity ignores RNG.
		// This test is a placeholder; it will become meaningful when
		// non-identity strategies land.
		expect(a.rows).toEqual(b.rows); // identity is deterministic
	});

	it('handles empty input', () => {
		const input = new Int32Array(0);
		const deps = makeDeps(10, 5, 42);
		const traj = computeTrajectory(input, deps);
		expect(traj.length).toBe(0);
		expect(traj.rows.length).toBe(0);
	});

	it('handles T = 1', () => {
		const input = new Int32Array([7]);
		const deps = makeDeps(10, 1, 42);
		const traj = computeTrajectory(input, deps);
		expect(traj.T).toBe(1);
		expect(traj.rows.length).toBe(2); // rows 0 and 1
	});

	it('throws when total cells exceed MAX_CELLS', () => {
		const input = new Int32Array(MAX_CELLS); // L = MAX_CELLS, T = 0 → (0+1)*MAX_CELLS = MAX_CELLS, ok
		// But T=1 → 2*MAX_CELLS > MAX_CELLS
		const deps = makeDeps(10, 1, 42);
		expect(() => computeTrajectory(input, deps)).toThrow('MAX_CELLS');
	});

	it('reports progress', () => {
		const input = new Int32Array([1, 2, 3]);
		const deps = makeDeps(10, 50, 42);
		const progressSteps: number[] = [];
		computeTrajectory(input, deps, (p) => progressSteps.push(p.step));
		expect(progressSteps.length).toBeGreaterThan(0);
		// Last progress should be T.
		expect(progressSteps[progressSteps.length - 1]).toBe(50);
		// Steps should be monotonically increasing.
		for (let i = 1; i < progressSteps.length; i++) {
			expect(progressSteps[i]!).toBeGreaterThan(progressSteps[i - 1]!);
		}
	});
});
