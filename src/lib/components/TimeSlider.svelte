<script lang="ts">
	interface Props {
		t: number;
		T: number;
		disabled: boolean;
		ontchange: (t: number) => void;
	}

	let { t, T, disabled, ontchange }: Props = $props();
</script>

<div class="time-slider">
	<label>
		t = {t} / {T}
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
</style>
