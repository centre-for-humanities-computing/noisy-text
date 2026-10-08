<script lang="ts">
	interface Props {
		t: number;
		T: number;
		disabled: boolean;
		ontchange: (t: number) => void;
		onTchange: (T: number) => void;
	}

	let { t, T, disabled, ontchange, onTchange }: Props = $props();

	/** Fraction $t/T$, formatted to 3 decimal places. */
	const fraction = $derived(T > 0 ? (t / T).toFixed(3) : '0.000');

	const canStep = $derived(!disabled && T > 0);

	function step(delta: number) {
		if (!canStep) return;
		const next = t + delta;
		if (next >= 0 && next <= T) ontchange(next);
	}

	/** Commit an edited max value; ignore non-positive input. */
	function commitT(e: Event) {
		const n = parseInt((e.currentTarget as HTMLInputElement).value, 10);
		if (n >= 1) onTchange(n);
	}
</script>

<div class="time-slider">
	<button
		class="step-btn"
		disabled={!canStep || t === 0}
		onclick={() => step(-1)}
		aria-label="Previous step">◀</button
	>
	<span class="readout">
		t = {t} /
		<input
			class="t-max"
			type="number"
			min="1"
			max="1000"
			step="1"
			value={T}
			aria-label="Total number of timesteps"
			{disabled}
			onchange={commitT}
		/>
		({fraction})
	</span>
	<input
		type="range"
		min="0"
		max={T}
		step="1"
		value={t}
		aria-label="Time step"
		disabled={disabled || T === 0}
		oninput={(e) => ontchange(parseInt(e.currentTarget.value, 10))}
	/>
	<button
		class="step-btn"
		disabled={!canStep || t === T}
		onclick={() => step(1)}
		aria-label="Next step">▶</button
	>
</div>

<style>
	.time-slider {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0.5rem 0;
	}
	.readout {
		font-size: 0.85rem;
		white-space: nowrap;
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}
	input {
		flex: 1;
	}
	.t-max {
		flex: 0 0 auto;
		width: 5ch;
		font-size: 0.85rem;
	}
	.step-btn {
		flex-shrink: 0;
		font-size: 0.75rem;
		padding: 2px 6px;
		line-height: 1;
		cursor: pointer;
	}
	.step-btn:disabled {
		cursor: default;
		opacity: 0.4;
	}
</style>
