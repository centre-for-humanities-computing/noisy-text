<script lang="ts">
	import { SvelteMap } from 'svelte/reactivity';
	import type { NeighborGraph } from '$lib/workers/trajectory.protocol.js';

	interface Props {
		graph: NeighborGraph;
	}

	let { graph }: Props = $props();

	const WIDTH = 320;
	const HEIGHT = 220;
	const CX = WIDTH / 2;
	const CY = HEIGHT / 2;
	const R1 = 70; // radius of the hop-1 ring
	const R2 = 100; // radius of the hop-2 ring

	/**
	 * Layout: center at the middle, hop-1 nodes evenly spaced on a ring,
	 * hop-2 nodes evenly spaced on an outer ring. Node positions are keyed
	 * by token id so edges can look them up.
	 */
	const positions = $derived.by(() => {
		const pos = new SvelteMap<number, { x: number; y: number }>();
		pos.set(graph.nodes.find((n) => n.hop === 0)!.id, { x: CX, y: CY });

		const hop1 = graph.nodes.filter((n) => n.hop === 1);
		hop1.forEach((n, i) => {
			const a = (2 * Math.PI * i) / hop1.length - Math.PI / 2;
			pos.set(n.id, { x: CX + R1 * Math.cos(a), y: CY + R1 * Math.sin(a) });
		});

		const hop2 = graph.nodes.filter((n) => n.hop === 2);
		hop2.forEach((n, i) => {
			const a = (2 * Math.PI * i) / hop2.length - Math.PI / 2 + Math.PI / hop2.length;
			pos.set(n.id, { x: CX + R2 * Math.cos(a), y: CY + R2 * Math.sin(a) });
		});
		return pos;
	});

	/** Edge stroke width in $[0.5, 4]$, proportional to weight. */
	function edgeWidth(w: number): number {
		return 0.5 + 3.5 * Math.min(1, Math.max(0, w));
	}

	/** Truncate long token labels for display. */
	function short(label: string): string {
		return label.length > 8 ? label.slice(0, 7) + '…' : label;
	}
</script>

<svg
	viewBox="0 0 {WIDTH} {HEIGHT}"
	class="neighbor-graph"
	role="img"
	aria-label="Local token neighborhood graph"
>
	{#each graph.edges as e (e.from + '-' + e.to)}
		{@const from = positions.get(e.from)}
		{@const to = positions.get(e.to)}
		{#if from && to}
			<line
				x1={from.x}
				y1={from.y}
				x2={to.x}
				y2={to.y}
				class="edge"
				style="stroke-width: {edgeWidth(e.weight)}"
			/>
		{/if}
	{/each}

	{#each graph.nodes as n (n.id)}
		{@const p = positions.get(n.id)}
		{#if p}
			<g class="node" class:center={n.hop === 0}>
				<circle cx={p.x} cy={p.y} r={n.hop === 0 ? 7 : 5} />
				<text x={p.x} y={p.y - (n.hop === 0 ? 12 : 10)} text-anchor="middle">{short(n.label)}</text>
			</g>
		{/if}
	{/each}
</svg>

<style>
	.neighbor-graph {
		width: 100%;
		height: auto;
		display: block;
	}

	.edge {
		stroke: #b8912a;
		stroke-opacity: 0.55;
		stroke-linecap: round;
	}

	.node circle {
		fill: #e8e8e8;
		stroke: #888;
		stroke-width: 1;
	}

	.node.center circle {
		fill: rgba(255, 200, 50, 0.9);
		stroke: #b8912a;
		stroke-width: 1.5;
	}

	.node text {
		font-family: monospace;
		font-size: 9px;
		fill: #222;
	}
</style>
