<script lang="ts">
	import InfoTooltip from './InfoTooltip.svelte';
	import type { Schedule } from '$lib/schedules/types.js';

	interface Props {
		/** Current timestep index $t$ shown on the time slider. */
		t: number;
		/** Active schedule instance, or null before first instantiation. */
		schedule: Schedule<unknown> | null;
	}

	let { t, schedule }: Props = $props();

	const SUBSCRIPT_DIGITS = '₀₁₂₃₄₅₆₇₈₉';

	/** Render $n$ as subscript digits, e.g. 50 → '₅₀'. */
	function subscript(n: number): string {
		return String(n)
			.split('')
			.map((d) => SUBSCRIPT_DIGITS[Number(d)] ?? d)
			.join('');
	}

	/** Format $\beta$ for display; below 0.001 show a bound instead of 0.000. */
	function formatBeta(b: number): string {
		return b < 0.001 ? '<0.001' : b.toFixed(3);
	}

	/** Format $\beta$ as a percentage with adaptive precision. */
	function formatPct(b: number): string {
		const pct = b * 100;
		if (pct < 0.01) return '<0.01';
		if (pct < 1) return pct.toFixed(2);
		return pct.toFixed(1);
	}

	// Effective per-step rate at the current timestep — includes the
	// multiplier $\lambda$, so this is exactly what the engine applies.
	// $\beta_t$ is defined for $0 \le t < T$; at $t = T$ the trajectory is
	// complete, so display the last applied step's rate.
	const step = $derived(schedule && schedule.T > 0 ? Math.min(t, schedule.T - 1) : 0);
	const currentBeta = $derived(schedule ? schedule.beta(step) : 0);

	// How the rate evolves over the trajectory: compare the first and
	// last per-step rates. Equal rates read as constant (covers constant
	// schedules and flat linear configs).
	const trend = $derived.by(() => {
		if (!schedule || schedule.T === 0) return null;
		const b0 = schedule.beta(0);
		const bLast = schedule.beta(schedule.T - 1);
		if (Math.abs(bLast - b0) < 1e-6) {
			return 'The rate never changes — every step corrupts the same fraction of tokens.';
		}
		const from = `β${subscript(0)} = ${formatBeta(b0)}`;
		const to = `β${subscript(schedule.T - 1)} = ${formatBeta(bLast)}`;
		return bLast > b0
			? `The rate rises from ${from} to ${to} — later steps corrupt more tokens than earlier ones.`
			: `The rate falls from ${from} to ${to} — early steps corrupt more tokens than later ones.`;
	});
	// Tooltip body: plain-language explanation followed by the trend.
	const tooltipText = $derived.by(() => {
		if (!trend) return '';
		return `At each step, this fraction of tokens is eligible for corruption. ${trend}`;
	});
</script>

{#if schedule && schedule.T > 0}
	<div class="beta-readout">
		<span class="beta-value">β{subscript(step)} = {formatBeta(currentBeta)}</span>
		<span class="beta-pct">≈ {formatPct(currentBeta)}% of tokens eligible this step</span>
		<InfoTooltip text={tooltipText} />
	</div>
{/if}

<style>
	.beta-readout {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0.15rem 0 0.35rem;
	}

	.beta-value {
		font-size: 0.8rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}

	.beta-pct {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}
</style>
