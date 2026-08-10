<script lang="ts">
	interface Props {
		seed: number;
		disabled: boolean;
		onseedchange: (seed: number) => void;
		onreroll: () => void;
	}

	let { seed, disabled, onseedchange, onreroll }: Props = $props();
</script>

<div class="seed-control">
	<label>
		Seed:
		<input
			type="number"
			min="0"
			max="4294967295"
			step="1"
			value={seed}
			{disabled}
			oninput={(e) => {
				const n = parseInt(e.currentTarget.value, 10);
				if (n >= 0) onseedchange(n);
			}}
		/>
	</label>
	<button {disabled} onclick={() => onreroll()}>Re-roll</button>
</div>

<style>
	.seed-control {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}
	label {
		font-size: 0.85rem;
	}
	input {
		width: 10ch;
		font-size: 0.85rem;
	}
	button {
		font-size: 0.85rem;
	}
</style>
