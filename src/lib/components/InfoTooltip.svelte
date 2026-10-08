<script lang="ts">
	import katex from 'katex';

	interface Props {
		/** Plain-language explanation (shown first). */
		text: string;
		/** Optional KaTeX maths string in $...$ notation. */
		math?: string;
	}

	let { text, math }: Props = $props();

	let open = $state(false);
	let buttonEl = $state<HTMLButtonElement>();

	/** Render the maths string via KaTeX, or empty string if not provided. */
	const renderedMath = $derived.by(() => {
		if (!math) return '';
		try {
			return katex.renderToString(math, { throwOnError: false, displayMode: false });
		} catch {
			return math;
		}
	});

	function toggle() {
		open = !open;
	}

	function close() {
		open = false;
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			close();
			buttonEl?.focus();
		}
	}

	/** Close on click outside the tooltip. */
	function onClickOutside(e: MouseEvent) {
		if (open && buttonEl && !buttonEl.contains(e.target as HTMLElement)) {
			const popover = buttonEl.nextElementSibling;
			if (popover && !popover.contains(e.target as HTMLElement)) {
				close();
			}
		}
	}
</script>

<svelte:window onclick={onClickOutside} />

<!-- Relative wrapper: anchors the popover to the button itself, independent
     of any positioned ancestor at the usage site. -->
<span class="info-wrap">
	<button
		bind:this={buttonEl}
		class="info-btn"
		aria-label="More information"
		aria-expanded={open}
		onclick={toggle}
		onmouseenter={() => {
			open = true;
		}}
		onmouseleave={() => {
			open = false;
		}}
		onkeydown={onKeydown}
	>
		?
	</button>

	{#if open}
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<div
			class="popover"
			role="tooltip"
			onmouseenter={() => {
				open = true;
			}}
			onmouseleave={() => {
				open = false;
			}}
			onkeydown={onKeydown}
		>
			<p class="popover-text">{text}</p>
			{#if renderedMath}
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				<div class="popover-math">{@html renderedMath}</div>
			{/if}
		</div>
	{/if}
</span>

<style>
	.info-wrap {
		position: relative;
		display: inline-flex;
		flex-shrink: 0;
	}
	.info-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		border: 1px solid var(--color-border);
		border-radius: 50%;
		background: #fff;
		color: var(--color-text-muted);
		font-size: 11px;
		font-weight: 600;
		cursor: pointer;
		line-height: 1;
		padding: 0;
		flex-shrink: 0;
	}
	.info-btn:hover,
	.info-btn[aria-expanded='true'] {
		background: var(--color-primary-tint);
		border-color: var(--color-primary);
		color: var(--color-primary);
	}

	.popover {
		position: absolute;
		z-index: 100;
		top: calc(100% + 6px);
		left: 50%;
		transform: translateX(-50%);
		width: 280px;
		max-width: calc(100vw - 2rem);
		padding: 0.75rem;
		background: #fff;
		border: 1px solid var(--color-border-light);
		border-radius: var(--radius-md);
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.12);
		font-size: var(--font-size-xs);
		line-height: 1.5;
		color: var(--color-text-secondary);
	}

	.popover-text {
		margin: 0 0 0.5rem;
	}

	.popover-math {
		padding-top: 0.5rem;
		border-top: 1px solid var(--color-border-light);
	}

	/* KaTeX overrides for tooltip context */
	:global(.popover .katex) {
		font-size: 0.9em;
	}
</style>
