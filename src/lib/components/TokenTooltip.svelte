<script lang="ts">
	import NeighborGraph from './NeighborGraph.svelte';
	import type { NeighborGraph as NeighborGraphData } from '$lib/workers/trajectory.protocol.js';

	interface Props {
		/** Viewport-space anchor point (top-left of the hovered token). */
		x: number;
		y: number;
		/**
		 * Tooltip state: `loading` while querying, `ready` with a graph,
		 * `error` when graph construction failed, `unavailable` when the
		 * strategy has no neighborhood support (trajectory still shown).
		 */
		state: 'loading' | 'ready' | 'error' | 'unavailable';
		/** The graph, when `state === 'ready'`. */
		graph: NeighborGraphData | null;
	}

	let { x, y, state, graph }: Props = $props();

	const OFFSET = 12;
	/** Tooltip width; position flips to the left when near the right edge. */
	const WIDTH = 340;

	const style = $derived.by(() => {
		const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
		const flip = x + WIDTH + OFFSET > vw;
		const left = flip ? x - WIDTH - OFFSET : x + OFFSET;
		return `left: ${left}px; top: ${y + OFFSET}px; width: ${WIDTH}px;`;
	});
</script>

<div class="token-tooltip" {style} role="tooltip">
	{#if state === 'loading'}
		<p class="msg">Computing trajectory…</p>
	{:else if state === 'error'}
		<p class="msg error">Failed to compute the inspection graph.</p>
	{:else if state === 'unavailable'}
		<p class="msg">Neighborhood not available for this strategy.</p>
	{:else if graph}
		<NeighborGraph {graph} />
	{/if}
</div>

<style>
	.token-tooltip {
		position: fixed;
		z-index: 200;
		background: #fff;
		border: 1px solid #ccc;
		border-radius: 6px;
		box-shadow: 0 2px 10px rgba(0, 0, 0, 0.15);
		padding: 8px;
		pointer-events: none;
	}

	.msg {
		margin: 0;
		font-size: 0.8rem;
		color: #555;
		font-family: system-ui, sans-serif;
	}

	.msg.error {
		color: #a33;
	}
</style>
