<script lang="ts">
	interface Props {
		showChips: boolean;
		disabled: boolean;
		onchange: (showChips: boolean) => void;
	}

	let { showChips, disabled, onchange }: Props = $props();
</script>

<div class="display-mode-toggle">
	<label>
		<input
			type="checkbox"
			checked={showChips}
			{disabled}
			onchange={(e) => onchange(e.currentTarget.checked)}
		/>
		show token chips
	</label>
</div>

<style>
	.display-mode-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}
	label {
		font-size: 0.85rem;
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}
</style>