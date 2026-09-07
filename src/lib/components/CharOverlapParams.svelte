<script lang="ts">
	interface Props {
		minSimilarity: number;
		k: number;
		epsilon: number;
		mode: 'set' | 'multiset';
		disabled: boolean;
		onminsimilaritychange: (v: number) => void;
		onkchange: (v: number) => void;
		onepsilonchange: (v: number) => void;
		onmodechange: (v: 'set' | 'multiset') => void;
	}

	let {
		minSimilarity,
		k,
		epsilon,
		mode,
		disabled,
		onminsimilaritychange,
		onkchange,
		onepsilonchange,
		onmodechange,
	}: Props = $props();
</script>

<div class="char-overlap-params">
	<div class="param-grid">
		<label>
			<span>Min similarity</span>
			<input
				type="range"
				min={0}
				max={1}
				step={0.01}
				value={minSimilarity}
				{disabled}
				oninput={(e) => onminsimilaritychange(Number(e.currentTarget.value))}
			/>
			<span class="param-value">{minSimilarity.toFixed(2)}</span>
		</label>

		<label>
			<span>Top-k</span>
			<input
				type="range"
				min={1}
				max={200}
				step={1}
				value={k}
				{disabled}
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
				{disabled}
				oninput={(e) => onepsilonchange(Number(e.currentTarget.value))}
			/>
			<span class="param-value">{epsilon.toFixed(3)}</span>
		</label>

		<label class="mode-toggle">
			<span>Multiset</span>
			<input
				type="checkbox"
				checked={mode === 'multiset'}
				{disabled}
				onchange={(e) => onmodechange(e.currentTarget.checked ? 'multiset' : 'set')}
			/>
		</label>
	</div>
</div>

<style>
	.char-overlap-params {
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

	.mode-toggle {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.8rem;
		cursor: pointer;
	}
</style>
