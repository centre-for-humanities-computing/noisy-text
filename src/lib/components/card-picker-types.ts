/**
 * Shared type for card-picker options.
 *
 * Every registry info object (StrategyInfo, ScheduleInfo, TokenizerInfo)
 * satisfies this interface, so CardPicker can render any of them.
 */
export interface CardOption {
	id: string;
	label: string;
	plainName: string;
	gloss: string;
	tooltip: {
		text: string;
		math?: string;
	};
}
