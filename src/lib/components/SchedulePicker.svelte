<script lang="ts">
	import CardPicker from './CardPicker.svelte';
	import type { ScheduleInfo } from '$lib/schedules/types.js';

	interface Props {
		value: string;
		options: readonly ScheduleInfo[];
		disabled: boolean;
		onchange: (id: string) => void;
	}

	let { value, options, disabled, onchange }: Props = $props();
</script>

<div class="schedule-picker">
	<CardPicker {value} {options} {disabled} {onchange} variant="quiet" />
</div>

<style>
	.schedule-picker {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}
</style>
