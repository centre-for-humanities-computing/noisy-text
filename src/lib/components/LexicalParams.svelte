<script lang="ts">
	interface Props {
		maxDistance: number;
		k: number;
		epsilon: number;
		tau: number;
		family: 'exponential' | 'power-law' | 'gaussian';
		disabled: boolean;
		onmaxdistancechange: (v: number) => void;
		onkchange: (v: number) => void;
		onepsilonchange: (v: number) => void;
		ontauchange: (v: number) => void;
		onfamilychange: (v: 'exponential' | 'power-law' | 'gaussian') => void;
	}

	let {
		maxDistance,
		k,
		epsilon,
		tau,
		family,
		disabled,
		onmaxdistancechange,
		onkchange,
		onepsilonchange,
		ontauchange,
		onfamilychange,
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
				{disabled}
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

		<label>
			<span>τ</span>
			<input
				type="range"
				min={0.05}
				max={5}
				step={0.05}
				value={tau}
				{disabled}
				oninput={(e) => ontauchange(Number(e.currentTarget.value))}
			/>
			<span class="param-value">{tau.toFixed(2)}</span>
		</label>

		<label>
			<span>Family</span>
			<select
				{disabled}
				value={family}
				onchange={(e) => onfamilychange(e.currentTarget.value as Props['family'])}
			>
				<option value="exponential">Exponential</option>
				<option value="power-law">Power law</option>
				<option value="gaussian">Gaussian</option>
			</select>
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
