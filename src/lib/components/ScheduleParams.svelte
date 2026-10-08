<script lang="ts">
	interface Props {
		/** Rate multiplier $\lambda$ applied to any schedule's $\beta_t$. */
		multiplier: number;
		disabled: boolean;
		onmultiplierchange: (v: number) => void;
	}

	let { multiplier, disabled, onmultiplierchange }: Props = $props();
</script>

<div class="schedule-params">
	<label>
		<span>Rate multiplier λ</span>
		<input
			type="range"
			min={0.1}
			max={10}
			step={0.1}
			value={multiplier}
			{disabled}
			oninput={(e) => onmultiplierchange(Number(e.currentTarget.value))}
		/>
		<span class="param-value">{multiplier.toFixed(1)}×</span>
	</label>
</div>

<style>
	.schedule-params {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.schedule-params label {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.8rem;
	}

	.param-value {
		min-width: 2.5rem;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
</style>
