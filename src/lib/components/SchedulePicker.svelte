<script lang="ts">
	import CardPicker from './CardPicker.svelte';
	import type { ScheduleInfo } from '$lib/schedules/types.js';

	interface Props {
		value: string;
		options: readonly ScheduleInfo[];
		disabled: boolean;
		T: number;
		onchange: (id: string) => void;
		onTchange: (T: number) => void;
	}

	let { value, options, disabled, T, onchange, onTchange }: Props = $props();
</script>

<div class="schedule-picker">
	<CardPicker {value} {options} {disabled} {onchange} variant="quiet" />
	<label>
		T =
		<input
			type="number"
			min="1"
			max="1000"
			step="1"
			value={T}
			oninput={(e) => {
				const n = parseInt(e.currentTarget.value, 10);
				if (n >= 1) onTchange(n);
			}}
		/>
	</label>
</div>

<style>
	.schedule-picker {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
	}
	label {
		font-size: 0.85rem;
	}
	input {
		width: 5ch;
		font-size: 0.85rem;
	}
</style>
