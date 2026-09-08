<script lang="ts">
	interface Props {
		t: number;
		T: number;
		disabled: boolean;
		ontchange: (t: number) => void;
	}

	let { t, T, disabled, ontchange }: Props = $props();

	/** Fraction $t/T$, formatted to 3 decimal places. */
	const fraction = $derived(T > 0 ? (t / T).toFixed(3) : '0.000');

	const canStep = $derived(!disabled && T > 0);

	function step(delta: number) {
		if (!canStep) return;
		const next = t + delta;
		if (next >= 0 && next <= T) ontchange(next);
	}
</script>

<div class="time-slider">
	<button
		class="step-btn"
		disabled={!canStep || t === 0}
		onclick={() => step(-1)}
		aria-label="Previous step">◀</button
	>
	<label>
		t = {t} / {T} ({fraction})
		<input
			type="range"
			min="0"
			max={T}
			step="1"
			value={t}
			disabled={disabled || T === 0}
			oninput={(e) => ontchange(parseInt(e.currentTarget.value, 10))}
		/>
	</label>
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
	label {
		font-size: 0.85rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
	}
	input {
		flex: 1;
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
