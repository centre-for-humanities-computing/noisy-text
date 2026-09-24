/**
 * Reactive store for the token-inspector (hover tooltip) settings.
 *
 * Controls how each hop's neighbor spread is limited in the tooltip
 * graph: top-$k$ (fixed count) or top-$p$ (cumulative probability).
 * Default is top-$p$ with $p = 0.95$.
 */
class InspectionStore {
	/** Spread limit mode per hop. */
	limitMode: 'top-k' | 'top-p' = $state('top-p');
	/** Top-k cutoff (used when `limitMode === 'top-k'`). */
	k: number = $state(8);
	/** Cumulative probability cutoff in $[0, 1]$ (used when `limitMode === 'top-p'`). */
	p: number = $state(0.95);
}

/** Singleton inspection store. */
export const inspectionStore = new InspectionStore();
