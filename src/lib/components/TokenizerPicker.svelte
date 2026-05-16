<script lang="ts">
	import type { TokenizerInfo } from '$lib/tokenizers/types.js';

	interface Props {
		value: string;
		options: readonly TokenizerInfo[];
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
