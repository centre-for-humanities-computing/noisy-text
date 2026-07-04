<script lang="ts">
	import type { StrategyInfo } from '$lib/strategies/types.js';

	interface Props {
		value: string;
		options: readonly StrategyInfo[];
		disabled: boolean;
		onchange: (id: string) => void;
	}

	let { value, options, disabled, onchange }: Props = $props();
</script>

<select {disabled} {value} onchange={(e) => onchange(e.currentTarget.value)}>
	{#each options as opt (opt.id)}
		<option value={opt.id} title={opt.description}>{opt.label}</option>
	{/each}
</select>
