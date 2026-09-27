<script lang="ts">
	import { SvelteMap } from 'svelte/reactivity';
	import type { NeighborGraph } from '$lib/workers/trajectory.protocol.js';

	interface Props {
		graph: NeighborGraph;
	}

	let { graph }: Props = $props();

	const WIDTH = 340;
	const HEIGHT = 220;
	const PAD = 34; // margin for node labels
	const NBHD_R = 62; // radius of the neighborhood fan around the current token

	/**
	 * Layout: the trajectory chain runs left → right (time flows rightward,
	 * matching the slider), vertically centered — one position per step, so
	 * stay events render as self-loops rather than collapsing. The current
	 * token's 1-hop neighborhood fans out around the final step.
	 *
	 * Positions are keyed by `t${step}` for trajectory nodes and `n${id}`
	 * for neighbors (ids can repeat across steps).
	 */
	const positions = $derived.by(() => {
		const pos = new SvelteMap<string, { x: number; y: number }>();

		const traj = graph.nodes.filter((n) => n.role === 'trajectory');
		const neighbors = graph.nodes.filter((n) => n.role === 'neighbor');

		// Trajectory: one slot per collapsed node, spread across the width,
		// leaving room on the right for the neighborhood fan.
		const trajSpan = WIDTH - PAD * 2 - (neighbors.length > 0 ? NBHD_R : 0);
		const n = traj.length;
		traj.forEach((node, i) => {
			const x = n === 1 ? WIDTH / 2 : PAD + (trajSpan * i) / (n - 1);
			pos.set(`t${i}`, { x, y: HEIGHT / 2 });
		});

		// Neighborhood: fan around the current (last step) node.
		if (n > 0 && neighbors.length > 0) {
			const c = { x: n === 1 ? WIDTH / 2 : PAD + trajSpan, y: HEIGHT / 2 };
			neighbors.forEach((node, i) => {
				// Spread over $[-60°, +60°]$ to the right of the current node.
				const a =
					neighbors.length === 1
						? 0
						: -Math.PI / 3 + ((2 * Math.PI) / 3) * (i / (neighbors.length - 1));
				pos.set(`n${node.id}`, {
					x: c.x + NBHD_R * Math.cos(a),
					y: c.y + NBHD_R * Math.sin(a),
				});
			});
		}

		return pos;
	});

	/** Ordered trajectory nodes (by step) for chain rendering. */
	const trajNodes = $derived(
		graph.nodes.filter((n) => n.role === 'trajectory').sort((a, b) => a.step - b.step),
	);

	/**
	 * Collapsed trajectory transitions: for each pair of adjacent
	 * trajectory nodes, the weight of the last step edge between them
	 * (stay events repeat the same weight, so the last is representative).
	 */
	const trajLinks = $derived.by(() => {
		const links: Array<{ fromIdx: number; toIdx: number; weight: number }> = [];
		let edgeIdx = 0;
		for (let i = 0; i < trajNodes.length - 1; i++) {
			const a = trajNodes[i]!;
			const b = trajNodes[i + 1]!;
			// Skip the stay edges within node a (count - 1 of them).
			edgeIdx += Math.max(0, (a.count ?? 1) - 1);
			const e = graph.edges[edgeIdx];
			links.push({ fromIdx: i, toIdx: i + 1, weight: e ? e.weight : 0 });
			edgeIdx += b.count ?? 1;
		}
		return links;
	});

	/** Edge stroke width in $[0.5, 4]$, proportional to weight. */
	function edgeWidth(w: number): number {
		return 0.5 + 3.5 * Math.min(1, Math.max(0, w));
	}

	/** Truncate long token labels for display. */
	function short(label: string): string {
		return label.length > 8 ? label.slice(0, 7) + '…' : label;
	}

	/** Arrowhead marker ids per edge class (trajectory vs neighborhood). */
	const TRAJ_MARKER = 'arrow-traj';
	const NBHD_MARKER = 'arrow-nbhd';
</script>

<svg
	viewBox="0 0 {WIDTH} {HEIGHT}"
	class="neighbor-graph"
	role="img"
	aria-label="Token trajectory and neighborhood graph"
>
	<defs>
		<marker
			id={TRAJ_MARKER}
			viewBox="0 0 10 10"
			refX="9"
			refY="5"
			markerWidth="6"
			markerHeight="6"
			orient="auto-start-reverse"
		>
			<path d="M 0 0 L 10 5 L 0 10 z" class="arrow-traj" />
		</marker>
		<marker
			id={NBHD_MARKER}
			viewBox="0 0 10 10"
			refX="9"
			refY="5"
			markerWidth="5"
			markerHeight="5"
			orient="auto-start-reverse"
		>
			<path d="M 0 0 L 10 5 L 0 10 z" class="arrow-nbhd" />
		</marker>
	</defs>

	{#each trajLinks as l, i (`${i}`)}
		{@const fromP = positions.get(`t${l.fromIdx}`)}
		{@const toP = positions.get(`t${l.toIdx}`)}
		{#if fromP && toP}
			<line
				x1={fromP.x}
				y1={fromP.y}
				x2={toP.x}
				y2={toP.y}
				class="edge-traj"
				style="stroke-width: {edgeWidth(l.weight)}"
				marker-end="url(#{TRAJ_MARKER})"
			/>
		{/if}
	{/each}

	<!-- Neighborhood edges: from the current token (last step) to each
	     neighbor node keyed by id. -->
	{#each graph.edges.filter((e) => !e.trajectory) as e, i (`${e.from}-${e.to}-${i}`)}
		{@const fromP = positions.get(`t${trajNodes.length - 1}`)}
		{@const toP = positions.get(`n${e.to}`)}
		{#if fromP && toP}
			<line
				x1={fromP.x}
				y1={fromP.y}
				x2={toP.x}
				y2={toP.y}
				class="edge-nbhd"
				style="stroke-width: {edgeWidth(e.weight)}"
				marker-end="url(#{NBHD_MARKER})"
			/>
		{/if}
	{/each}

	{#each trajNodes as n, i (`t${n.step}`)}
		{@const p = positions.get(`t${i}`)}
		{#if p}
			<g class="node" class:current={i === trajNodes.length - 1}>
				<circle cx={p.x} cy={p.y} r={6} />
				<text x={p.x} y={p.y - 10} text-anchor="middle">
					{short(n.label)}{(n.count ?? 1) > 1 ? ` ×${n.count}` : ''}
				</text>
			</g>
		{/if}
	{/each}

	{#each graph.nodes.filter((nd) => nd.role === 'neighbor') as n (`n${n.id}`)}
		{@const p = positions.get(`n${n.id}`)}
		{#if p}
			<g class="node neighbor">
				<circle cx={p.x} cy={p.y} r={4.5} />
				<text x={p.x} y={p.y - 10} text-anchor="middle">{short(n.label)}</text>
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

	/* Trajectory edges: strong amber, the walked path. */
	.edge-traj {
		stroke: #b8912a;
		stroke-opacity: 0.9;
		stroke-linecap: round;
		fill: none;
	}

	/* Neighborhood edges: muted gray-blue. */
	.edge-nbhd {
		stroke: #7a8ba0;
		stroke-opacity: 0.45;
		stroke-linecap: round;
	}

	.arrow-traj {
		fill: #b8912a;
	}

	.arrow-nbhd {
		fill: #7a8ba0;
	}

	.node circle {
		fill: #dfe4ea;
		stroke: #9aa7b5;
		stroke-width: 1;
	}

	/* Trajectory nodes: amber fill, visually distinct. */
	g.node.current circle {
		fill: rgba(255, 200, 50, 0.95);
		stroke: #b8912a;
		stroke-width: 1.5;
	}

	.node text {
		font-family: monospace;
		font-size: 9px;
		fill: #333;
	}

	g.node.current text {
		fill: #000;
		font-weight: bold;
	}
</style>
