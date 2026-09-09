<script lang="ts">
	import type { CharRange } from '$lib/engine/diff.js';

	interface Props {
		text: string;
		ranges?: readonly CharRange[];
	}

	let { text, ranges = [] }: Props = $props();

	/**
	 * Split `text` into segments, marking changed spans with their recency.
	 * `ranges` must be sorted and non-overlapping (as produced by
	 * `tokenCharRanges`).
	 */
	function segments(
		text: string,
		ranges: readonly CharRange[],
	): Array<{ text: string; recency?: number }> {
		const out: Array<{ text: string; recency?: number }> = [];
		let pos = 0;
		for (const r of ranges) {
			if (r.start > pos) {
				out.push({ text: text.slice(pos, r.start) });
			}
			if (r.end > r.start) {
				out.push({ text: text.slice(r.start, r.end), recency: r.recency });
			}
			pos = r.end;
		}
		if (pos < text.length) {
			out.push({ text: text.slice(pos) });
		}
		return out;
	}
</script>

{#if ranges.length === 0}
	<p class="inline-text">{text}</p>
{:else}
	<p class="inline-text">
		{#each segments(text, ranges) as seg, i (i)}
			{#if seg.recency !== undefined}
				<span class="taper" style="--r: {seg.recency}">{seg.text}</span>
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
	}
</style>
