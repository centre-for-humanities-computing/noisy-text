<script lang="ts">
	import { viewStore } from '$lib/stores/view.svelte.js';

	function close() {
		viewStore.aboutOpen = false;
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') close();
	}

	function onClickOutside(e: MouseEvent) {
		const panel = document.querySelector('.about-overlay');
		const inner = document.querySelector('.about-panel');
		if (panel && inner && panel === e.target) {
			close();
		}
	}
</script>

<svelte:window onkeydown={onKeydown} />

<div
	class="about-overlay"
	role="dialog"
	aria-label="How this works"
	tabindex="-1"
	onclick={onClickOutside}
	onkeydown={onKeydown}
>
	<div class="about-panel">
		<button class="close-btn" aria-label="Close" onclick={close}>&times;</button>

		<h2>How this works</h2>

		<p>
			<strong>noisy-text</strong> lets you watch text dissolve through a
			<em>noise process</em> — a step-by-step random walk that gradually corrupts each token. It's inspired
			by diffusion models, the same family of techniques behind modern image and audio generators, but
			applied to discrete text instead of continuous pixels.
		</p>

		<p>
			Scrub the timeline back and forth to see the text decay and recover. At each step, every token
			has a small chance of changing into something else. The <strong>strategy</strong>
			decides <em>what</em> it changes into: a blank, a random token, a similarly-spelled token, or
			a token that shares the same letters. The <strong>schedule</strong> controls <em>how fast</em> the
			noise ramps up — gently at first, then faster, or at a steady pace. The highlights show you which
			tokens changed most recently. Everything is deterministic: the same seed always produces the same
			sequence of changes.
		</p>

		<h3>What this is (and isn't)</h3>

		<p>
			This is a <strong>forward process only</strong> — it shows how text degrades under noise, not how
			to reconstruct it. There's no training, no denoising, no text generation. It is merely a playground
			for investigating different kinds of "noisy text".
		</p>

		<p>
			For the technical reader: the maths follows the D3PM framework (Austin et al., 2021). Each
			strategy defines a Markov transition matrix $Q_t = (1-\beta_t)I + \beta_t R$, and the schedule
			provides $\beta_t$. Hover over any ? icon to see the exact equations.
		</p>
	</div>
</div>

<style>
	.about-overlay {
		position: fixed;
		inset: 0;
		z-index: 200;
		background: rgba(0, 0, 0, 0.3);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}

	.about-panel {
		position: relative;
		max-width: 560px;
		width: 100%;
		max-height: 80vh;
		overflow-y: auto;
		background: #fff;
		border-radius: var(--radius-md);
		padding: 1.5rem;
		box-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
		font-family: var(--font-ui);
		font-size: var(--font-size-md);
		line-height: 1.6;
		color: var(--color-text-secondary);
	}

	.about-panel h2 {
		margin: 0 0 1rem;
		font-size: var(--font-size-xl);
		color: var(--color-text);
	}

	.about-panel h3 {
		margin: 1.25rem 0 0.5rem;
		font-size: var(--font-size-lg);
		color: var(--color-text);
	}

	.about-panel p {
		margin: 0 0 0.75rem;
	}

	.close-btn {
		position: absolute;
		top: 0.75rem;
		right: 0.75rem;
		width: 28px;
		height: 28px;
		border: none;
		background: none;
		font-size: 1.25rem;
		color: var(--color-text-muted);
		cursor: pointer;
		border-radius: var(--radius-sm);
		display: flex;
		align-items: center;
		justify-content: center;
		line-height: 1;
	}

	.close-btn:hover {
		background: var(--color-primary-tint);
		color: var(--color-primary);
	}
</style>
