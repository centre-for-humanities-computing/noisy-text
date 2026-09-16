<script lang="ts">
	import CardPicker from './CardPicker.svelte';
	import type { TokenizerInfo } from '$lib/tokenizers/types.js';

	interface Props {
		value: string;
		options: readonly TokenizerInfo[];
		disabled: boolean;
		onchange: (id: string) => void;
	}

	let { value, options, disabled, onchange }: Props = $props();
</script>

<CardPicker {value} {options} {disabled} {onchange} variant="quiet" />
