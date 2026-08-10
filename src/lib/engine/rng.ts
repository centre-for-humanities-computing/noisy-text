import seedrandom from 'seedrandom';
import type { Rng } from '../strategies/types.js';

/**
 * Create a seeded PRNG using the Alea algorithm.
 *
 * Uses `seedrandom.alea` (~1.95 ns/call) rather than the default ARC4
 * (~3.8 ns/call). The seed is stringified with a null terminator to
 * prevent ARC4-style key-cycling collisions (e.g. `'1'`, `'11'`, `'111'`
 * would produce identical streams without the terminator).
 *
 * @param seed - An integer seed.
 * @returns A function `() => number` returning values in $[0, 1)$.
 */
export function createRng(seed: number): Rng {
	// seedrandom.alea is a constructor; `new` is optional.
	// The null terminator prevents short-key cycling.
	return seedrandom.alea(String(seed) + '\0');
}

/**
 * Generate a random integer seed for UI-initiated re-rolls.
 *
 * Uses `Math.random()` — allowed by CONVENTIONS for trivial UI use.
 * Not suitable for engine-internal seeding.
 *
 * @returns A random 32-bit unsigned integer.
 */
export function randomSeed(): number {
	return (Math.random() * 0xffffffff) >>> 0;
}
