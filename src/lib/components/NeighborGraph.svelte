<script lang="ts">
	import { computeForceLayout } from '$lib/engine/force-layout.js';
	import type { NeighborGraph } from '$lib/workers/trajectory.protocol.js';

	interface Props {
		graph: NeighborGraph;
	}

	let { graph }: Props = $props();

	const WIDTH = 360;
	const HEIGHT = 260;

	/**
	 * Chronology ramp: single-hue amber saturation. A node or edge's
	 * saturation goes from pale (origin, $s = 0$) to full (current, $s =
	 * t$). Neighborhood elements inherit their anchor's saturation but
	 * stay muted (lower opacity) so the trajectory reads on top.
	 */
	const maxStep = $derived(Math.max(1, ...graph.nodes.map((n) => n.anchorStep)));

	/** Saturation ramp $[0, 1]$: 0 = pale origin, 1 = full current. */
	function ramp(step: number): number {
		return Math.min(1, Math.max(0, step / maxStep));
	}

	/**
	 * Amber fill for a node: mix pale (#f5edd8) into full (#e8a20c) by
	 * the ramp value. Neighbor nodes are desaturated toward gray.
	 */
	function nodeFill(role: string, step: number): string {
		const t = ramp(step);
		if (role === 'neighbor') {
			// Muted: mix the amber ramp into a light gray.
			const base = 0.35 * t;
			const r = Math.round(223 + (232 - 223) * base);
			const g = Math.round(228 + (162 - 228) * base);
			const b = Math.round(234 + (12 - 234) * base);
			return `rgb(${r}, ${g}, ${b})`;
		}
		const r = Math.round(245 + (232 - 245) * t);
		const g = Math.round(237 + (162 - 237) * t);
		const b = Math.round(216 + (12 - 216) * t);
		return `rgb(${r}, ${g}, ${b})`;
	}

	/** Amber stroke for an edge, ramped by its anchor step. */
	function edgeColor(trajectory: boolean, step: number): string {
		const t = ramp(step);
		if (!trajectory) {
			// Muted gray-blue for neighborhood edges.
			return `rgba(122, 139, 160, ${0.25 + 0.3 * t})`;
		}
		return `rgba(184, 145, 42, ${0.45 + 0.5 * t})`;
	}

	/** Edge stroke width in $[0.5, 4]$, proportional to weight. */
	function edgeWidth(w: number): number {
		return 0.5 + 3.5 * Math.min(1, Math.max(0, w));
	}

	/** Truncate long token labels for display. */
	function short(label: string): string {
		return label.length > 8 ? label.slice(0, 7) + '…' : label;
	}

	/**
	 * Force-directed layout over the whole graph (trajectory + neighbors).
	 * Deterministic; computed once per graph.
	 */
	const positions = $derived.by(() => {
		const nodes = graph.nodes.map((n) => ({ key: `${n.id}` }));
		const edges = graph.edges.map((e) => ({
			from: `${e.from}`,
			to: `${e.to}`,
			weight: e.trajectory ? 1 : 0.4,
		}));
		return computeForceLayout(nodes, edges, { width: WIDTH, height: HEIGHT });
	});

	const pos = $derived(positions);
</script>

<svg
	viewBox="0 0 {WIDTH} {HEIGHT}"
	class="neighbor-graph"
	role="img"
	aria-label="Token trajectory through its neighborhood"
>
	<defs>
		<marker
			id="arrow-traj"
			viewBox="0 0 10 10"
			refX="9"
			refY="5"
			markerWidth="6"
			markerHeight="6"
			orient="auto-start-reverse"
		>
			<path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
		</marker>
	</defs>

	<!-- Edges: neighborhood first (under), trajectory on top. -->
	{#each graph.edges.filter((e) => !e.trajectory) as e, i (`${e.from}-${e.to}-${i}`)}
		{@const a = pos.get(`${e.from}`)}
		{@const b = pos.get(`${e.to}`)}
		{#if a && b}
			<line
				x1={a.x}
				y1={a.y}
				x2={b.x}
				y2={b.y}
				class="edge-nbhd"
				style="stroke: {edgeColor(false, e.anchorStep)}; stroke-width: {edgeWidth(e.weight)}"
				marker-end="url(#arrow-traj)"
			/>
		{/if}
	{/each}

	{#each graph.edges.filter((e) => e.trajectory) as e, i (`${e.from}-${e.to}-${i}`)}
		{@const a = pos.get(`${e.from}`)}
		{@const b = pos.get(`${e.to}`)}
		{#if a && b}
			<g>
				<line
					x1={a.x}
					y1={a.y}
					x2={b.x}
					y2={b.y}
					class="edge-traj"
					style="stroke: {edgeColor(true, e.anchorStep)}; stroke-width: {edgeWidth(e.weight)}"
					marker-end="url(#arrow-traj)"
				/>
				<!-- Step annotation at the edge midpoint. -->
				<text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 4} text-anchor="middle" class="step-label"
					>t={e.steps.join(',')}</text
				>
			</g>
		{/if}
	{/each}

	<!-- Nodes: neighbors under, trajectory on top. -->
	{#each graph.nodes.filter((n) => n.role === 'neighbor') as n (`n${n.id}`)}
		{@const p = pos.get(`${n.id}`)}
		{#if p}
			<g class="node neighbor">
				<circle cx={p.x} cy={p.y} r={4.5} style="fill: {nodeFill('neighbor', n.anchorStep)}" />
				<text x={p.x} y={p.y - 8} text-anchor="middle" class="label-nbhd">{short(n.label)}</text>
			</g>
		{/if}
	{/each}

	{#each graph.nodes.filter((n) => n.role === 'trajectory') as n (`t${n.id}`)}
		{@const p = pos.get(`${n.id}`)}
		{#if p}
			<g class="node traj" class:current={n.anchorStep === maxStep}>
				<circle cx={p.x} cy={p.y} r={6} style="fill: {nodeFill('trajectory', n.anchorStep)}" />
				<text x={p.x} y={p.y - 9} text-anchor="middle" class="label-traj">{short(n.label)}</text>
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

	.edge-traj {
		stroke-linecap: round;
	}

	.edge-nbhd {
		stroke-linecap: round;
	}

	.node circle {
		stroke: rgba(120, 110, 80, 0.6);
		stroke-width: 1;
	}

	g.node.traj circle {
		stroke: #b8912a;
		stroke-width: 1.5;
	}

	g.node.current circle {
		stroke-width: 2.5;
	}

	.label-traj {
		font-family: monospace;
		font-size: 9px;
		fill: #333;
	}

	.label-nbhd {
		font-family: monospace;
		font-size: 8px;
		fill: #8a94a0;
	}

	.step-label {
		font-family: monospace;
		font-size: 7px;
		fill: #a08030;
		paint-order: stroke;
		stroke: #fff;
		stroke-width: 2.5px;
		stroke-linejoin: round;
	}
</style>
