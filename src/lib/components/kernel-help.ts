/**
 * UI copy for the kernel controls (τ, weight family, and the kernel
 * itself) in the advanced settings panels.
 *
 * Single source of truth so `LexicalParams` and `CharOverlapParams`
 * cannot drift: both import the same captions and tooltips. Plain
 * words in `text`, raw KaTeX (no `$` delimiters) in `math` — matching
 * `StrategyInfo.tooltip` and `InfoTooltip`'s `math` prop.
 */

export interface HelpCopy {
	readonly text: string;
	readonly math: string;
}

/** One-sentence caption above the kernel controls. */
export const KERNEL_CAPTION =
	'Weight family and temperature τ decide where a token jumps (the kernel); ' +
	'the schedule decides how often it jumps. Top-k and Max distance set the ' +
	'neighbourhood; setting Floor ε above 0 keeps every token reachable.';

/** Math for a jump: $Q_t = (1-\beta_t)I + \beta_t K_\tau$. */
export const KERNEL_TOOLTIP: HelpCopy = {
	text:
		'A jumping token is drawn from a transition kernel over its nearest ' +
		'neighbours. Distances are turned into weights by the family and ' +
		'temperature, then normalised so every row sums to one. The token itself ' +
		'is excluded, and the ergodicity floor ε mixes in a little uniform noise ' +
		'so no token becomes unreachable.',
	math:
		'K_\\tau(j\\mid i) \\propto w_\\tau(d(i,j)),\\ j \\in N_k(i)\\setminus\\{i\\};\\quad ' +
		'Q_t = (1-\\beta_t)\\,I + \\beta_t\\,K_\\tau',
};

export const TAU_TOOLTIP: HelpCopy = {
	text:
		'Temperature controls how far a jump strays. Low τ sends almost every ' +
		'jump to the single nearest neighbour; high τ spreads the choice almost ' +
		'evenly across the k nearest tokens.',
	math: '\\tau \\to 0:\\ \\text{nearest neighbour};\\quad \\tau \\to \\infty:\\ \\text{uniform over top-}k',
};

export const TOPK_TOOLTIP: HelpCopy = {
	text:
		'How many nearest tokens a jump may land on. Larger k spreads jumps over ' +
		'more candidates (and costs more to compute); smaller k keeps jumps ' +
		'concentrated on the closest matches.',
	math: 'j \\in N_k(i),\\ |N_k(i)| = k',
};

export const EPSILON_TOOLTIP: HelpCopy = {
	text:
		'The optional ergodicity floor: with probability ε a jump ignores the ' +
		'neighbourhood and lands on any token uniformly. At ε = 0 tokens only ' +
		'move between nearest neighbours; raising it keeps the process connected ' +
		'even when the neighbourhood graph is not.',
	math: 'P(y\\mid i) = (1-\\varepsilon)\\,K_\\tau(y\\mid i) + \\varepsilon/K',
};

export const FAMILY_TOOLTIP: HelpCopy = {
	text:
		'The weight family decides how fast probability falls off with distance. ' +
		'Exponential decays smoothly; power law has a heavy tail (occasional long ' +
		'jumps); Gaussian falls off very quickly (almost only the nearest ' +
		'neighbours).',
	math:
		'w_\\tau(d) = \\exp(-d/\\tau);\\quad (1+d)^{-1/\\tau};\\quad ' +
		'\\exp\\!\\left(-d^2/2\\tau^2\\right)',
};
