<script lang="ts">
	import type { TokenCharSpan } from '$lib/engine/diff.js';

	interface Props {
		text: string;
		/** Per-token character spans (from `allTokenCharSpans`). */
		spans?: readonly TokenCharSpan[];
		/** Called on token hover with the token id, its index, and bounding rect. */
		onhover?: (tokenId: number, index: number, rect: DOMRect) => void;
		/** Called when the pointer leaves a token span. */
		onunhover?: () => void;
	}

	let { text, spans = [], onhover, onunhover }: Props = $props();

	/**
	 * Split `text` into per-token segments. Each span contributes its slice
	 * of `text`; gaps between spans (mask positions, empty tokens) are
	 * emitted as plain text. Spans must be sorted and non-overlapping.
	 */
	function segments(
		text: string,
		spans: readonly TokenCharSpan[],
	): Array<{ text: string; span?: TokenCharSpan }> {
		const out: Array<{ text: string; span?: TokenCharSpan }> = [];
		let pos = 0;
		for (const s of spans) {
			if (s.start > pos) {
				out.push({ text: text.slice(pos, s.start) });
			}
			if (s.end > s.start) {
				out.push({ text: text.slice(s.start, s.end), span: s });
			}
			pos = s.end;
		}
		if (pos < text.length) {
			out.push({ text: text.slice(pos) });
		}
		return out;
	}
</script>

{#if spans.length === 0}
	<p class="inline-text">{text}</p>
{:else}
	<p class="inline-text">
		{#each segments(text, spans) as seg, i (i)}
			{#if seg.span}
				<span
					class="taper"
					style="--r: {seg.span.recency}"
					role="button"
					tabindex={0}
					aria-label="token {seg.text}"
					onmouseenter={(e) =>
						onhover?.(seg.span!.tokenId, seg.span!.index, e.currentTarget.getBoundingClientRect())}
					onmouseleave={() => onunhover?.()}
					onfocus={(e) =>
						onhover?.(seg.span!.tokenId, seg.span!.index, e.currentTarget.getBoundingClientRect())}
					onblur={() => onunhover?.()}>{seg.text}</span
				>
			{:else}
				{seg.text}
			{/if}
		{/each}
	</p>
{/if}

<style>
	.inline-text {
		font-family: system-ui, sans-serif;
		font-size: 1rem;
		line-height: 1.7;
		white-space: pre-wrap;
		word-break: break-word;
		margin: 0;
	}

	.taper {
		/*
		 * Fading highlight: recency $r \in [0, 1]$ drives the background
		 * opacity. $r = 1$ (just changed) → full highlight; $r \to 0$ → no
		 * highlight. The color is a warm amber that fades to transparent.
		 */
		background: rgba(255, 200, 50, var(--r));
		border-radius: 2px;
		transition: background 0.15s;
	}

	@media (prefers-reduced-motion: reduce) {
		.taper {
			transition: none;
		}
	}
</style>
