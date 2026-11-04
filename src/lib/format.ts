/**
 * Format an integer with plain-space thousands separators (`50 000`).
 *
 * Explicit grouping keeps the status line independent of the browser locale,
 * unlike `toLocaleString()`.
 */
export function formatCount(n: number): string {
	return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
