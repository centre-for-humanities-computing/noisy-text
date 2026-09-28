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

	/**
	 * Edge stroke width, proportional to weight. Neighborhood edges run
	 * $[0.5, 4]$; trajectory edges get a higher floor (1.5) so they stand
	 * out even when the transition probability is small.
	 */
	function edgeWidth(w: number, trajectory: boolean): number {
		const t = 3.5 * Math.min(1, Math.max(0, w));
		return trajectory ? 1.5 + t : 0.5 + t;
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
			// Neighbor springs stronger than the layout default so neighbors
			// cluster near their anchors instead of spreading across the box.
			weight: e.trajectory ? 1 : 0.8,
		}));
		return computeForceLayout(nodes, edges, {
			width: WIDTH,
			height: HEIGHT,
			idealLength: 42,
		});
	});

	const pos = $derived(positions);

	/** Trajectory edges in render order. */
	const trajEdges = $derived(graph.edges.filter((e) => e.trajectory));

	/**
	 * Geometry per trajectory edge: a path (straight, or bowed when the
	 * edge would overlap another — either the same directed edge
	 * traversed multiple times, or the reverse edge also present, since
	 * $A \to B$ and $B \to A$ share the same straight chord) plus a
	 * collision-avoided label position.
	 * Labels are placed at the edge midpoint, nudged along a fixed
	 * deterministic candidate list until they don't cover an earlier
	 * label — overlapping edges would otherwise stack labels.
	 */
	const trajGeom = $derived.by(() => {
		const placed: { x: number; y: number }[] = [];
		// Directed edge keys present, to detect reverse-edge overlap.
		const keys = new Set(trajEdges.map((e) => `${e.from}->${e.to}`));
		// Candidate label offsets from the midpoint, in preference order.
		const candidates: [number, number][] = [
			[0, 0],
			[0, -9],
			[0, 9],
			[-16, 0],
			[16, 0],
			[0, -18],
			[0, 18],
			[-16, -9],
			[16, 9],
			[-16, 9],
			[16, -9],
		];
		return trajEdges.map((e) => {
			const a = pos.get(`${e.from}`);
			const b = pos.get(`${e.to}`);
			if (!a || !b) return null;
			const dx = b.x - a.x;
			const dy = b.y - a.y;
			const len = Math.hypot(dx, dy) || 1;
			// Unit normal; bow lifts the curve off the straight chord.
			const nx = -dy / len;
			const ny = dx / len;
			// Bow when this edge is traversed more than once, or when the
			// reverse edge exists (both directions share the same chord).
			const bow = e.steps.length > 1 || keys.has(`${e.to}->${e.from}`) ? 14 : 0;
			const mx = (a.x + b.x) / 2;
			const my = (a.y + b.y) / 2;
			const pathD = `M ${a.x} ${a.y} Q ${mx + nx * bow * 2} ${my + ny * bow * 2} ${b.x} ${b.y}`;
			// Quadratic midpoint sits at half the control offset.
			const baseX = mx + nx * bow;
			const baseY = my + ny * bow;
			let lx = baseX;
			let ly = baseY;
			for (const [ox, oy] of candidates) {
				const cx = baseX + ox;
				const cy = baseY + oy;
				if (placed.every((p) => Math.hypot(p.x - cx, p.y - cy) >= 15)) {
					lx = cx;
					ly = cy;
					break;
				}
			}
			placed.push({ x: lx, y: ly });
			return { pathD, lx, ly };
		});
	});
</script>

<svg
	viewBox="0 0 {WIDTH} {HEIGHT}"
	class="neighbor-graph"
	role="img"
	aria-label="Token trajectory through its neighborhood"
>
	<defs>
		<!-- Fixed-size arrowhead: markerUnits defaults to strokeWidth, so
		     scale the marker box up to keep arrowheads legible on thin
		     edges (they previously shrank with stroke width). -->
		<marker
			id="arrow-traj"
			viewBox="0 0 10 10"
			refX="9"
			refY="5"
			markerWidth="6"
			markerHeight="6"
			markerUnits="userSpaceOnUse"
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
				style="stroke: {edgeColor(false, e.anchorStep)}; stroke-width: {edgeWidth(e.weight, false)}"
			/>
		{/if}
	{/each}

	{#each trajEdges as e, i (`${e.from}-${e.to}-${i}`)}
		{@const g = trajGeom[i]}
		{#if g}
			<g>
				<path
					d={g.pathD}
					fill="none"
					class="edge-traj"
					style="stroke: {edgeColor(true, e.anchorStep)}; stroke-width: {edgeWidth(e.weight, true)}"
					marker-end="url(#arrow-traj)"
				/>
				<!-- Step annotation near the edge midpoint: every step at which
				     this transition was taken, ascending. -->
				<text x={g.lx} y={g.ly - 4} text-anchor="middle" class="step-label"
					>t={e.steps.toSorted((x, y) => x - y).join(',')}</text
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
