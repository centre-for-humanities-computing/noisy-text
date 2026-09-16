<script lang="ts">
	import CardPicker from './CardPicker.svelte';
	import type { StrategyInfo } from '$lib/strategies/types.js';

	interface Props {
		value: string;
		options: readonly StrategyInfo[];
		disabled: boolean;
		onchange: (id: string) => void;
	}

	let { value, options, disabled, onchange }: Props = $props();
</script>

<CardPicker {value} {options} {disabled} {onchange} variant="primary" />
