/**
 * UI copy for the advanced-parameter controls that are strategy- or
 * schedule-specific and not shared between panels (those live in
 * `kernel-help.ts`). Plain words in `text`, optional raw KaTeX (no `$`
 * delimiters) in `math` — matching `InfoTooltip`'s props.
 */

export interface ParamHelp {
	readonly text: string;
	readonly math?: string;
}

export const MAX_DISTANCE_TOOLTIP: ParamHelp = {
	text:
		'How far a jump may reach, in edit-distance units. Distance 1 keeps ' +
		'noise to near-identical spellings; larger values reach broader ' +
		'misspellings.',
	math: 'd(i,j) \\le \\text{maxDistance}',
};

export const MIN_SIMILARITY_TOOLTIP: ParamHelp = {
	text:
		"How alike two tokens' characters must be before a jump is allowed. " +
		'Higher values restrict jumps to near-identical token shapes; lower ' +
		'values permit looser overlaps.',
	math: 'J(i,j) \\ge s',
};

export const MULTISET_TOOLTIP: ParamHelp = {
	text:
		"When on, repeated characters count: 'aab' and 'ab' differ. When off, " +
		'only the distinct set of characters matters.',
};

export const PREPROCESSING_TOOLTIP: ParamHelp = {
	text:
		'How embedding rows are transformed before distances are computed. Raw ' +
		'is fastest but noisiest; mean-center and whiten remove the dominant ' +
		'shared component so nearest neighbours reflect meaning rather than ' +
		'overall frequency.',
	math: 'x \\mapsto x - \\bar{x}',
};

export const METRIC_TOOLTIP: ParamHelp = {
	text:
		'How distance between two embedding vectors is measured. Cosine ' +
		'compares direction and ignores magnitude, which usually works best in ' +
		'high dimensions; L2 compares straight-line distance.',
	math: '1-\\cos(a,b) \\quad\\text{vs}\\quad \\lVert a-b\\rVert_2',
};

export const TOKEN_CLASS_TOOLTIP: ParamHelp = {
	text:
		'Which tokens may be jump targets. Word-initial only lands on tokens ' +
		'that begin a word (avoids gluing word fragments); Continuation only on ' +
		'mid-word pieces; Any allows both.',
};

export const EXCLUDE_SPECIAL_TOOLTIP: ParamHelp = {
	text: 'Skip special tokens such as [CLS], [SEP] and </s> as jump targets — they carry no word meaning.',
};

export const EXCLUDE_UNUSED_TOOLTIP: ParamHelp = {
	text: 'Skip BERT [unusedN] placeholder rows that fill out the vocabulary.',
};

export const EXCLUDE_BYTE_FALLBACK_TOOLTIP: ParamHelp = {
	text: 'Skip byte-fallback tokens like <0x4F>, which stand for raw bytes rather than words.',
};

export const RATE_MULTIPLIER_TOOLTIP: ParamHelp = {
	text:
		'Scales how much noise the schedule applies everywhere: higher values ' +
		'corrupt faster, lower values slower. 1 is the schedule as designed.',
	math: '\\beta_t \\mapsto \\lambda\\,\\beta_t',
};
