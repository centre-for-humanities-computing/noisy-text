<script lang="ts">
	import '../app.css';
	import 'katex/dist/katex.min.css';
	import AboutPanel from '$lib/components/AboutPanel.svelte';
	import { viewStore } from '$lib/stores/view.svelte.js';
</script>

<header class="app-header">
	<span class="app-title">noisy-text</span>
	<button
		class="about-btn"
		aria-label="How this works"
		title="How this works"
		onclick={() => {
			viewStore.aboutOpen = true;
		}}
	>
		?
	</button>
</header>

<slot />

{#if viewStore.aboutOpen}
	<AboutPanel />
{/if}

<style>
	.app-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		max-width: 960px;
		margin: 0 auto;
		padding: 0.75rem 1.5rem 0;
	}
	.app-title {
		font-family: var(--font-ui);
		font-size: var(--font-size-xl);
		font-weight: 600;
		color: var(--color-text);
	}
	.about-btn {
		width: 28px;
		height: 28px;
		border: 1px solid var(--color-border);
		border-radius: 50%;
		background: #fff;
		color: var(--color-text-secondary);
		font-size: var(--font-size-sm);
		font-weight: 600;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		line-height: 1;
	}
	.about-btn:hover {
		background: var(--color-primary-tint);
		border-color: var(--color-primary);
		color: var(--color-primary);
	}
</style>
