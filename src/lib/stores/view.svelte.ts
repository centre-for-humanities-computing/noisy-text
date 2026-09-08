/**
 * Reactive store for view/app-mode state.
 *
 * Holds UI-only concerns: which mode we're in, which display style,
 * whether the advanced panel is open, and the taper window size.
 * Does not import engine, strategies, or tokenizers.
 */

export type AppMode = 'edit' | 'explore';
export type DisplayStyle = 'prose' | 'chips';

class ViewStore {
	/** Current app mode: editing input or exploring noise. */
	mode: AppMode = $state('edit');
	/** Display style for the noisy view. */
	display: DisplayStyle = $state('prose');
	/** Whether the advanced technical panel is open. */
	advancedOpen: boolean = $state(false);
	/** Number of steps over which change highlights fade (default 4). */
	taperWindow: number = $state(4);
}

/** Singleton view store. */
export const viewStore = new ViewStore();
