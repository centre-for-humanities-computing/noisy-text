<script lang="ts">
	import SchedulePlot from './SchedulePlot.svelte';
	import type { Schedule } from '$lib/schedules/types.js';
	import type { StrategyInfo } from '$lib/strategies/types.js';

	interface Props {
		schedule: Schedule<unknown> | null;
		strategyInfo: StrategyInfo | null;
	}

	let { schedule, strategyInfo }: Props = $props();

	const stationaryLabel = $derived.by(() => {
		if (!strategyInfo) return null;
		switch (strategyInfo.stationary) {
			case 'uniform':
				return 'Converges to a uniform distribution — every token equally likely in the long run.';
			case 'point-mass':
				return 'Converges to a single absorbing state — all tokens eventually collapse to one value.';
			case 'data-dependent':
				return 'Stationary distribution depends on the input text — different starting points may converge to different states.';
			case 'unknown':
				return 'Stationary behavior not characterized.';
		}
	});
</script>

<div class="advanced-panel">
	<h3 class="panel-heading">Advanced</h3>

	{#if schedule}
		<section class="panel-section">
			<h4 class="section-heading">Noise schedule</h4>
			<SchedulePlot {schedule} />
		</section>
	{/if}

	{#if strategyInfo}
		<section class="panel-section">
			<h4 class="section-heading">Diagnostics</h4>
			<dl class="diag-list">
				<dt>Strategy</dt>
				<dd>{strategyInfo.label}</dd>
				<dt>Stationary behavior</dt>
				<dd>{stationaryLabel}</dd>
			</dl>
		</section>
	{/if}

	<section class="panel-section">
		<h4 class="section-heading">Token inspector</h4>
		<p class="stub-note">
			Click a token in the chips view to see its per-step transition distribution. (Coming soon.)
		</p>
	</section>
</div>

<style>
	.advanced-panel {
		margin-top: var(--space-md);
		padding: var(--space-md);
		border: 1px solid var(--color-border-light);
		border-radius: var(--radius-md);
		background: var(--color-panel-bg);
		font-family: var(--font-ui);
	}

	.panel-heading {
		margin: 0 0 var(--space-md);
		font-size: var(--font-size-md);
		color: var(--color-text);
	}

	.panel-section {
		margin-bottom: var(--space-md);
	}

	.panel-section:last-child {
		margin-bottom: 0;
	}

	.section-heading {
		margin: 0 0 var(--space-sm);
		font-size: var(--font-size-sm);
		color: var(--color-text-secondary);
		font-weight: 600;
	}

	.diag-list {
		margin: 0;
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.25rem var(--space-lg);
		font-size: var(--font-size-xs);
	}

	.diag-list dt {
		color: var(--color-text-muted);
		font-weight: 500;
	}

	.diag-list dd {
		margin: 0;
		color: var(--color-text-secondary);
	}

	.stub-note {
		margin: 0;
		font-size: var(--font-size-xs);
		color: var(--color-text-quiet);
		font-style: italic;
	}
</style>
