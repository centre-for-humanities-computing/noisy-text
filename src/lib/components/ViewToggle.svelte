<script lang="ts">
	import type { DisplayStyle } from '$lib/stores/view.svelte.js';

	interface Props {
		value: DisplayStyle;
		disabled?: boolean;
		onchange: (value: DisplayStyle) => void;
	}

	let { value, disabled = false, onchange }: Props = $props();

	const OPTIONS: readonly { value: DisplayStyle; label: string; title: string }[] = [
		{ value: 'prose', label: 'Prose', title: 'Decaying text with recency highlights' },
		{ value: 'chips', label: 'Tokens', title: 'Token chips with token ids' },
		{ value: 'graph', label: 'Graph', title: 'All trajectories in one pan/zoom graph' },
	];

	let buttons: HTMLButtonElement[] = [];

	function onKeydown(e: KeyboardEvent, index: number): void {
		let next = -1;
		if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % OPTIONS.length;
		else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
			next = (index - 1 + OPTIONS.length) % OPTIONS.length;
		else return;
		e.preventDefault();
		// Keep the global ←/→ t-stepper from also firing.
		e.stopPropagation();
		onchange(OPTIONS[next]!.value);
		buttons[next]?.focus();
	}
</script>

<div class="view-toggle" role="radiogroup" aria-label="Display style">
	{#each OPTIONS as o, i (o.value)}
		<button
			bind:this={buttons[i]}
			role="radio"
			aria-checked={value === o.value}
			tabindex={value === o.value ? 0 : -1}
			title={o.title}
			{disabled}
			class:active={value === o.value}
			onclick={() => onchange(o.value)}
			onkeydown={(e) => onKeydown(e, i)}
		>
			{o.label}
		</button>
	{/each}
</div>

<style>
	.view-toggle {
		display: inline-flex;
		border: 1px solid var(--color-border, #ccc);
		border-radius: var(--radius-md, 6px);
		overflow: hidden;
	}
	button {
		padding: 0.2rem 0.7rem;
		font-size: 0.8rem;
		border: none;
		background: #fff;
		color: var(--color-text-secondary, #555);
		cursor: pointer;
	}
	button + button {
		border-left: 1px solid var(--color-border, #ccc);
	}
	button:hover:not(:disabled):not(.active) {
		background: var(--color-panel-bg, #f9fafb);
	}
	button.active {
		background: var(--color-primary-tint, #e0e7ff);
		color: var(--color-primary, #2563eb);
		font-weight: 600;
	}
	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	button:focus-visible {
		outline: 2px solid var(--color-primary, #2563eb);
		outline-offset: -2px;
	}
</style>
