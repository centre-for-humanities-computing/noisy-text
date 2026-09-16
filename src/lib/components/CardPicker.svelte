<script lang="ts">
	import InfoTooltip from './InfoTooltip.svelte';
	import type { CardOption } from './card-picker-types.js';

	interface Props {
		/** Currently selected option id. */
		value: string;
		/** Available options. */
		options: readonly CardOption[];
		/** Whether the picker is disabled. */
		disabled: boolean;
		/** Called when the user selects an option. */
		onchange: (id: string) => void;
		/** Visual emphasis: 'primary' for strategy, 'quiet' for tokenizer/schedule. */
		variant?: 'primary' | 'quiet';
	}

	let { value, options, disabled, onchange, variant = 'primary' }: Props = $props();

	/** Index of the currently focused card (for roving tabindex). */
	let focusedIndex = $state(0);

	$effect(() => {
		const idx = options.findIndex((o) => o.id === value);
		if (idx !== -1) focusedIndex = idx;
	});

	function select(id: string) {
		if (disabled) return;
		onchange(id);
	}

	function onCardKeydown(e: KeyboardEvent, idx: number) {
		const n = options.length;
		let next: number;
		switch (e.key) {
			case 'ArrowRight':
			case 'ArrowDown':
				e.preventDefault();
				next = (idx + 1) % n;
				focusedIndex = next;
				break;
			case 'ArrowLeft':
			case 'ArrowUp':
				e.preventDefault();
				next = (idx - 1 + n) % n;
				focusedIndex = next;
				break;
			case 'Enter':
			case ' ':
				e.preventDefault();
				select(options[idx]!.id);
				break;
		}
	}
</script>

<div
	class="card-picker"
	class:primary={variant === 'primary'}
	class:quiet={variant === 'quiet'}
	role="radiogroup"
	aria-label="Options"
>
	{#each options as opt, i (opt.id)}
		<button
			class="card"
			class:selected={opt.id === value}
			role="radio"
			aria-checked={opt.id === value}
			tabindex={i === focusedIndex ? 0 : -1}
			{disabled}
			onclick={() => select(opt.id)}
			onkeydown={(e) => onCardKeydown(e, i)}
		>
			<div class="card-header">
				<span class="card-name">{opt.plainName}</span>
				<InfoTooltip text={opt.tooltip.text} math={opt.tooltip.math} />
			</div>
			<span class="card-label">{opt.label}</span>
			<span class="card-gloss">{opt.gloss}</span>
		</button>
	{/each}
</div>

<style>
	.card-picker {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-sm);
	}

	/* Primary (strategy): larger cards, more emphasis */
	.primary .card {
		flex: 1 1 160px;
		min-width: 140px;
		padding: 0.6rem 0.75rem;
	}

	/* Quiet (tokenizer, schedule): smaller, de-emphasised */
	.quiet .card {
		flex: 0 1 auto;
		min-width: 120px;
		padding: 0.4rem 0.6rem;
		font-size: var(--font-size-xs);
	}

	.card {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: #fff;
		cursor: pointer;
		text-align: left;
		font-family: var(--font-ui);
		transition:
			border-color var(--transition-fast),
			box-shadow var(--transition-fast);
		position: relative;
	}

	.card:hover:not(:disabled) {
		border-color: var(--color-primary);
		box-shadow: 0 1px 4px rgba(37, 99, 235, 0.15);
	}

	.card:focus-visible {
		outline: 2px solid var(--color-primary);
		outline-offset: 2px;
	}

	.card.selected {
		border-color: var(--color-primary);
		background: var(--color-primary-tint);
	}

	.card:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.card-header {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}

	.card-name {
		font-weight: 600;
		color: var(--color-text);
	}

	.quiet .card-name {
		font-size: var(--font-size-sm);
	}

	.card-label {
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
	}

	.card-gloss {
		font-size: var(--font-size-xs);
		color: var(--color-text-quiet);
		line-height: 1.4;
	}
</style>
