<script lang="ts">
	interface Props {
		maxDistance: number;
		k: number;
		epsilon: number;
		disabled: boolean;
		onmaxdistancechange: (v: number) => void;
		onkchange: (v: number) => void;
		onepsilonchange: (v: number) => void;
	}

	let {
		maxDistance,
		k,
		epsilon,
		disabled,
		onmaxdistancechange,
		onkchange,
		onepsilonchange,
	}: Props = $props();
</script>

<div class="lexical-params">
	<div class="param-grid">
		<label>
			<span>Max distance</span>
			<input
				type="range"
				min={1}
				max={3}
				step={1}
				value={maxDistance}
				disabled={disabled}
				oninput={(e) => onmaxdistancechange(Number(e.currentTarget.value))}
			/>
			<span class="param-value">{maxDistance}</span>
		</label>

		<label>
			<span>Top-k</span>
			<input
				type="range"
				min={1}
				max={200}
				step={1}
				value={k}
				disabled={disabled}
				oninput={(e) => onkchange(Number(e.currentTarget.value))}
			/>
			<span class="param-value">{k}</span>
		</label>

		<label>
			<span>Floor ε</span>
			<input
				type="range"
				min={0}
				max={0.5}
				step={0.005}
				value={epsilon}
				disabled={disabled}
				oninput={(e) => onepsilonchange(Number(e.currentTarget.value))}
			/>
			<span class="param-value">{epsilon.toFixed(3)}</span>
		</label>
	</div>
</div>

<style>
	.lexical-params {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.param-grid {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.param-grid label {
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