<script lang="ts">
	import { untrack } from 'svelte';
	import { zoomAt, panBy, fitBounds, boundsOf } from '$lib/engine/camera.js';
	import { idToNodeMap, occupancyAt } from '$lib/engine/union-graph.js';
	import { placeLabels } from '$lib/engine/label-placement.js';
	import type { Camera } from '$lib/engine/camera.js';
	import type { Trajectory } from '$lib/engine/types.js';
	import type { UnionGraph, UnionGraphPhase } from '$lib/workers/trajectory.protocol.js';
	import type { GraphStatus } from '$lib/stores/graph.svelte.js';

	/** Label font and box height (px). Boxes keep `LABEL_GAP` px clear of each other. */
	const LABEL_FONT = '10px system-ui, sans-serif';
	const LABEL_HEIGHT = 11;
	const LABEL_GAP = 4;
	const LABEL_CELL = 48;
	/** Label caps: every visible node when zoomed in, held nodes only when zoomed out. */
	const LABEL_CAP_IN = 1200;
	const LABEL_CAP_OUT = 40;

	interface Props {
		graph: UnionGraph | null;
		status: GraphStatus;
		progress: number;
		phase: UnionGraphPhase | null;
		error: string | null;
		/** The trajectory (for occupancy and hover details). */
		traj: Trajectory | null;
		/** Current slider position. */
		t: number;
		/** Fade window for newly revealed elements (same as the taper). */
		taperWindow: number;
	}

	let { graph, status, progress, phase, error, traj, t, taperWindow }: Props = $props();

	// ---- DOM refs & sizing ----
	let container: HTMLDivElement;
	let canvas: HTMLCanvasElement;
	let width = 0;
	let height = 0;

	function dpr(): number {
		return (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
	}

	// ---- Camera & interaction state (imperative, redrawn on demand) ----
	// Deliberately not `$state`: the template never reads the camera. Each
	// change is followed by `requestDraw()`, which repaints from the rAF loop.
	// As reactive state, an effect that wrote the camera and then read it
	// (see `fit`) re-triggered itself on every run.
	let cam: Camera = { x: 0, y: 0, zoom: 1 };
	let fitZoom = 1;
	/** Graph object the camera was last fitted to (plain, not reactive). */
	let fittedFor: UnionGraph | null = null;
	let dragging = false;
	let dragMoved = false;
	let lastX = 0;
	let lastY = 0;
	let drawScheduled = false;

	// ---- Scratch buffers (reused across frames) ----
	let sxBuf = new Float32Array(0);
	let syBuf = new Float32Array(0);
	let rBuf = new Float32Array(0);
	// Label candidates (node, anchor, width) for the current frame, and the
	// measured label width of each node for the current graph.
	let candNode = new Int32Array(0);
	let candX = new Float32Array(0);
	let candY = new Float32Array(0);
	let candW = new Float32Array(0);
	let labelWGraph: UnionGraph | null = null;
	let labelWCache = new Float32Array(0);

	function ensureCandBufs(n: number): void {
		if (candNode.length < n) {
			candNode = new Int32Array(n);
			candX = new Float32Array(n);
			candY = new Float32Array(n);
			candW = new Float32Array(n);
		}
	}

	function ensureBufs(n: number): void {
		if (sxBuf.length < n) {
			sxBuf = new Float32Array(n);
			syBuf = new Float32Array(n);
			rBuf = new Float32Array(n);
		}
	}

	// ---- Hover tooltip (reactive; renders a DOM tooltip) ----
	let hover: {
		ni: number;
		x: number;
		y: number;
	} | null = $state(null);

	const idToNode = $derived(graph ? idToNodeMap(graph.ids) : new Map<number, number>());

	/** Info for the hovered node, derived from graph + current row. */
	const hoverInfo = $derived.by(() => {
		const g = graph;
		const h = hover;
		if (!g || !h || h.ni >= g.nodeCount) return null;
		const tr = traj;
		let count = 0;
		const positions: number[] = [];
		if (tr) {
			const row = tr.tokensAt(Math.min(t, tr.T));
			for (let i = 0; i < row.length; i++) {
				if (idToNode.get(row[i]!) === h.ni) {
					count++;
					if (positions.length < 6) positions.push(i);
				}
			}
		}
		return {
			label: g.labels[h.ni] ?? '',
			id: g.ids[h.ni]!,
			step: g.trajStep[h.ni]!,
			reveal: g.revealStep[h.ni]!,
			count,
			positions,
		};
	});

	// ---- Draw scheduling ----
	function requestDraw(): void {
		if (!drawScheduled) {
			drawScheduled = true;
			requestAnimationFrame(() => {
				drawScheduled = false;
				draw();
			});
		}
	}

	// ---- Colors (matching the NeighborGraph tooltip ramp) ----
	const maxStep = $derived(graph ? Math.max(1, graph.T) : 1);

	/** Saturation ramp $[0, 1]$ by first-appearance step. */
	function ramp(step: number): number {
		return Math.min(1, Math.max(0, step / maxStep));
	}

	function trajNodeFill(step: number): string {
		const u = ramp(step);
		const r = Math.round(245 + (232 - 245) * u);
		const g = Math.round(237 + (162 - 237) * u);
		const b = Math.round(216 + (12 - 216) * u);
		return `rgb(${r}, ${g}, ${b})`;
	}

	// ---- The draw loop ----
	function draw(): void {
		const g = graph;
		if (!canvas || !g) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		const d = dpr();
		if (canvas.width !== Math.round(width * d) || canvas.height !== Math.round(height * d)) {
			canvas.width = Math.round(width * d);
			canvas.height = Math.round(height * d);
		}
		ctx.setTransform(d, 0, 0, d, 0, 0);
		ctx.clearRect(0, 0, width, height);

		const tNow = t;
		const n = g.nodeCount;
		ensureBufs(n);
		const zoom = cam.zoom;

		// Occupancy at the current step.
		const row = traj ? traj.tokensAt(Math.max(0, Math.min(tNow, traj.T))) : null;
		const occ = row ? occupancyAt(row, idToNode, n) : new Int32Array(n);

		// Screen positions of revealed nodes.
		const rel = g.revealStep;
		const lx = g.layoutX;
		const ly = g.layoutY;
		for (let i = 0; i < n; i++) {
			sxBuf[i] = (lx[i]! - cam.x) * zoom + width / 2;
			syBuf[i] = (ly[i]! - cam.y) * zoom + height / 2;
		}

		const fade = (step: number): number => {
			const age = tNow - step;
			const w = Math.max(1, taperWindow);
			return age >= w ? 1 : 0.25 + (0.75 * age) / w;
		};

		// Node screen radius: constant px when zoomed in, shrinking at low
		// zoom so the full graph doesn't turn into a wall of dots.
		const nodeBase = 3.2 * Math.max(0.45, Math.min(1.2, zoom / 0.6));

		// ---- Edges: neighborhood first, then trajectory on top ----
		const es = g.edgeSrc;
		const ed = g.edgeDst;
		const ef = g.edgeFirstStep;
		const ec = g.edgeCount;
		const et = g.edgeTraj;
		const margin = 60;
		for (let e = 0; e < es.length; e++) {
			if (ef[e]! > tNow) continue;
			const a = es[e]!;
			const b = ed[e]!;
			const x1 = sxBuf[a]!;
			const y1 = syBuf[a]!;
			const x2 = sxBuf[b]!;
			const y2 = syBuf[b]!;
			if (
				(x1 < -margin && x2 < -margin) ||
				(x1 > width + margin && x2 > width + margin) ||
				(y1 < -margin && y2 < -margin) ||
				(y1 > height + margin && y2 > height + margin)
			)
				continue;
			if (et[e]) {
				const u = ramp(ef[e]!);
				ctx.strokeStyle = `rgba(184, 145, 42, ${(0.45 + 0.5 * u) * fade(ef[e]!)})`;
				ctx.lineWidth = Math.min(5.5, 1.2 + 1.3 * Math.log2(1 + ec[e]!));
			} else {
				ctx.strokeStyle = 'rgba(122, 139, 160, 0.25)';
				ctx.lineWidth = 1;
			}
			ctx.beginPath();
			ctx.moveTo(x1, y1);
			ctx.lineTo(x2, y2);
			ctx.stroke();
		}

		// ---- Nodes: neighbors, then trajectory ----
		const ts = g.trajStep;
		for (let i = 0; i < n; i++) {
			rBuf[i] = 0;
		}
		for (let i = 0; i < n; i++) {
			if (ts[i]! >= 0) continue; // traj nodes below
			if (rel[i]! > tNow) continue;
			const x = sxBuf[i]!;
			const y = syBuf[i]!;
			if (x < -20 || x > width + 20 || y < -20 || y > height + 20) continue;
			ctx.fillStyle = 'rgb(223, 228, 234)';
			ctx.strokeStyle = 'rgba(122, 139, 160, 0.6)';
			ctx.lineWidth = 1;
			ctx.beginPath();
			ctx.arc(x, y, nodeBase * 0.75, 0, 2 * Math.PI);
			ctx.fill();
			ctx.stroke();
			rBuf[i] = nodeBase * 0.75;
		}
		for (let i = 0; i < n; i++) {
			if (ts[i]! < 0) continue;
			if (rel[i]! > tNow) continue;
			const x = sxBuf[i]!;
			const y = syBuf[i]!;
			if (x < -20 || x > width + 20 || y < -20 || y > height + 20) continue;
			const count = occ[i]!;
			const r = count > 0 ? Math.min(14, nodeBase + 1.6 * Math.sqrt(count)) : nodeBase;
			rBuf[i] = r;
			ctx.fillStyle = trajNodeFill(ts[i]!);
			ctx.strokeStyle = count > 0 ? 'rgba(140, 105, 15, 0.95)' : 'rgba(184, 145, 42, 0.55)';
			ctx.lineWidth = count > 0 ? 1.5 : 1;
			ctx.beginPath();
			ctx.arc(x, y, r, 0, 2 * Math.PI);
			ctx.fill();
			ctx.stroke();
		}

		// ---- Labels: held nodes first, then (zoomed in) the rest. Placed so that no two
		// labels overlap; zoomed out, only a small set is shown. ----
		const zoomedIn = zoom > 2.5 * fitZoom;
		ctx.font = LABEL_FONT;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		if (labelWGraph !== g) {
			labelWGraph = g;
			labelWCache = new Float32Array(n).fill(-1);
		}

		const held: number[] = [];
		const rest: number[] = [];
		for (let i = 0; i < n; i++) {
			if (ts[i]! < 0 || rel[i]! > tNow) continue;
			if (occ[i]! > 0) held.push(i);
			else if (zoomedIn) rest.push(i);
		}
		// Most positions first; ties go to the node nearest the view centre.
		const cx0 = width / 2;
		const cy0 = height / 2;
		const centreD2 = (i: number): number => {
			const dx = sxBuf[i]! - cx0;
			const dy = syBuf[i]! - cy0;
			return dx * dx + dy * dy;
		};
		held.sort((a, b) => occ[b]! - occ[a]! || centreD2(a) - centreD2(b));

		ensureCandBufs(n);
		let m = 0;
		const addCandidate = (i: number): void => {
			const x = sxBuf[i]!;
			const y = syBuf[i]! - rBuf[i]! - 8; // the label sits above its marker
			if (x < 0 || x > width || y < 0 || y > height) return;
			let w = labelWCache[i]!;
			if (w < 0) {
				w = ctx.measureText(g.labels[i]!).width;
				labelWCache[i] = w;
			}
			candNode[m] = i;
			candX[m] = x;
			candY[m] = y;
			candW[m] = w;
			m++;
		};
		for (const i of held) addCandidate(i);
		for (const i of rest) addCandidate(i);

		const shown = placeLabels(m, candX, candY, candW, {
			width,
			height,
			labelHeight: LABEL_HEIGHT,
			maxLabels: zoomedIn ? LABEL_CAP_IN : LABEL_CAP_OUT,
			gap: LABEL_GAP,
			cell: LABEL_CELL,
		});
		for (const k of shown) {
			const i = candNode[k]!;
			const x = candX[k]!;
			const y = candY[k]!;
			ctx.lineWidth = 3;
			ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
			ctx.strokeText(g.labels[i]!, x, y);
			ctx.fillStyle = '#444';
			ctx.fillText(g.labels[i]!, x, y);
		}

		// ---- Hover highlight ring ----
		if (hover) {
			const x = sxBuf[hover.ni]!;
			const y = syBuf[hover.ni]!;
			ctx.strokeStyle = 'rgba(37, 99, 235, 0.9)';
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.arc(x, y, (rBuf[hover.ni]! || nodeBase) + 3, 0, 2 * Math.PI);
			ctx.stroke();
		}
	}

	// Redraw whenever reactive inputs change.
	$effect(() => {
		void graph;
		void status;
		void t;
		void taperWindow;
		requestDraw();
	});

	// Fit the camera once per graph object. Re-reads of the same graph (each
	// slider move causes one) must not move the view. The camera write inside
	// `fit()` stays untracked.
	$effect(() => {
		const g = graph;
		if (!g || status !== 'ready' || g === fittedFor) return;
		untrack(() => fit());
	});

	// ---- Resize handling ----
	$effect(() => {
		const ro = new ResizeObserver((entries) => {
			const rect = entries[0]?.contentRect;
			if (!rect) return;
			width = rect.width;
			height = rect.height;
			if (width > 0 && height > 0 && graph && status === 'ready' && graph !== fittedFor) {
				fit();
			}
			requestDraw();
		});
		ro.observe(container);
		return () => ro.disconnect();
	});

	// ---- Wheel zoom (non-passive so we can preventDefault) ----
	$effect(() => {
		const handler = (e: WheelEvent): void => {
			e.preventDefault();
			const rect = canvas.getBoundingClientRect();
			const factor = Math.exp(-e.deltaY * 0.0015);
			cam = zoomAt(cam, factor, e.clientX - rect.left, e.clientY - rect.top, {
				width,
				height,
			});
			requestDraw();
		};
		canvas.addEventListener('wheel', handler, { passive: false });
		return () => canvas.removeEventListener('wheel', handler);
	});

	// ---- Pan / hover ----
	function onPointerDown(e: PointerEvent): void {
		if (e.button !== 0) return;
		dragging = true;
		dragMoved = false;
		lastX = e.clientX;
		lastY = e.clientY;
		canvas.setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent): void {
		if (dragging) {
			const dx = e.clientX - lastX;
			const dy = e.clientY - lastY;
			lastX = e.clientX;
			lastY = e.clientY;
			if (dx !== 0 || dy !== 0) {
				dragMoved = true;
				cam = panBy(cam, dx, dy);
				setHover(null);
				requestDraw();
			}
			return;
		}
		updateHover(e);
	}

	function onPointerUp(e: PointerEvent): void {
		if (!dragging) return;
		dragging = false;
		canvas.releasePointerCapture?.(e.pointerId);
		if (!dragMoved) updateHover(e);
	}

	/** Set the hovered node. The ring is painted on the canvas, so repaint when it changes. */
	function setHover(next: { ni: number; x: number; y: number } | null): void {
		const changed = (next?.ni ?? -1) !== (hover?.ni ?? -1);
		hover = next;
		if (changed) requestDraw();
	}

	function onPointerLeave(): void {
		setHover(null);
	}

	/** Nearest revealed node within a small screen radius of the pointer. */
	function updateHover(e: PointerEvent): void {
		const g = graph;
		if (!g || status !== 'ready') {
			setHover(null);
			return;
		}
		const rect = canvas.getBoundingClientRect();
		const mx = e.clientX - rect.left;
		const my = e.clientY - rect.top;
		const tNow = t;
		let best = -1;
		let bestD2 = 100; // 10 px radius
		const rel = g.revealStep;
		for (let i = 0; i < g.nodeCount; i++) {
			if (rel[i]! > tNow) continue;
			const dx = (g.layoutX[i]! - cam.x) * cam.zoom + width / 2 - mx;
			const dy = (g.layoutY[i]! - cam.y) * cam.zoom + height / 2 - my;
			const d2 = dx * dx + dy * dy;
			if (d2 < bestD2) {
				bestD2 = d2;
				best = i;
			}
		}
		setHover(best >= 0 ? { ni: best, x: mx, y: my } : null);
	}

	// ---- Buttons & keyboard ----
	function zoomBy(factor: number): void {
		cam = zoomAt(cam, factor, width / 2, height / 2, { width, height });
		requestDraw();
	}

	function fit(): void {
		const g = graph;
		if (!g || width === 0) return;
		const next = fitBounds(boundsOf(g.layoutX, g.layoutY), { width, height }, 40);
		cam = next;
		fitZoom = next.zoom;
		fittedFor = g;
		requestDraw();
	}

	function onKeydown(e: KeyboardEvent): void {
		let handled = true;
		if (e.key === '+' || e.key === '=') zoomBy(1.25);
		else if (e.key === '-' || e.key === '_') zoomBy(0.8);
		else if (e.key === '0') fit();
		else if (e.key === 'ArrowLeft') cam = panBy(cam, 60, 0);
		else if (e.key === 'ArrowRight') cam = panBy(cam, -60, 0);
		else if (e.key === 'ArrowUp') cam = panBy(cam, 0, 60);
		else if (e.key === 'ArrowDown') cam = panBy(cam, 0, -60);
		else handled = false;
		if (handled) {
			// Keep the global ←/→ t-stepper from also firing.
			e.stopPropagation();
			e.preventDefault();
			requestDraw();
		}
	}

	function positionsText(pos: number[]): string {
		return pos.map((i) => `#${i}`).join(', ');
	}
</script>

<div class="full-graph" bind:this={container}>
	<canvas
		bind:this={canvas}
		tabindex="0"
		aria-label="Full token graph. Scroll to zoom, drag to pan, arrow keys to pan, plus and minus to zoom, zero to fit."
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointerleave={onPointerLeave}
		onkeydown={onKeydown}
		ondblclick={fit}
	></canvas>

	<div class="overlay-buttons">
		<button class="graph-btn" title="Zoom in (+)" onclick={() => zoomBy(1.25)}>+</button>
		<button class="graph-btn" title="Zoom out (−)" onclick={() => zoomBy(0.8)}>−</button>
		<button class="graph-btn" title="Fit graph (0)" onclick={fit}>⤢</button>
	</div>

	<div class="hint" aria-hidden="true">scroll to zoom · drag to pan · hover a node</div>

	{#if graph?.truncated}
		<div class="notice">Neighborhood truncated to keep the graph below 20k nodes.</div>
	{/if}

	{#if hover && hoverInfo}
		<div class="node-tooltip" style="left: {hover.x + 14}px; top: {hover.y + 14}px" role="tooltip">
			<div class="nt-label">{hoverInfo.label}</div>
			<div class="nt-meta">
				{#if hoverInfo.step >= 0}
					token #{hoverInfo.id} · first visited at step {hoverInfo.step}
				{:else}
					token #{hoverInfo.id} · neighbor, appears with step {hoverInfo.reveal}
				{/if}
			</div>
			<div class="nt-meta">
				{hoverInfo.count > 0
					? `held by ${hoverInfo.count} position${hoverInfo.count === 1 ? '' : 's'}${
							hoverInfo.positions.length ? ` (${positionsText(hoverInfo.positions)})` : ''
						}`
					: 'not currently held'}
			</div>
		</div>
	{/if}

	{#if status !== 'ready'}
		<div class="state-overlay">
			{#if status === 'computing'}
				<p class="state-msg">
					{phase === 'layout' ? 'Laying out graph' : 'Building neighborhood'}…
					{Math.round(progress * 100)}%
				</p>
				<div
					class="state-bar"
					role="progressbar"
					aria-valuemin="0"
					aria-valuemax="100"
					aria-valuenow={Math.round(progress * 100)}
				>
					<div class="state-bar-fill" style:transform={`scaleX(${progress})`}></div>
				</div>
			{:else if status === 'error'}
				<p class="state-msg error">Failed to build the graph: {error ?? 'unknown error'}</p>
			{:else}
				<p class="state-msg">Building graph…</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.full-graph {
		position: relative;
		height: 60vh;
		min-height: 320px;
		border: 1px solid var(--color-border-light, #e5e7eb);
		border-radius: var(--radius-md, 6px);
		overflow: hidden;
		background: #fcfcfd;
	}
	canvas {
		width: 100%;
		height: 100%;
		display: block;
		cursor: grab;
		outline: none;
	}
	canvas:active {
		cursor: grabbing;
	}

	.overlay-buttons {
		position: absolute;
		top: 0.5rem;
		right: 0.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.graph-btn {
		width: 1.8rem;
		height: 1.8rem;
		padding: 0;
		font-size: 0.9rem;
		line-height: 1;
		border: 1px solid var(--color-border, #ccc);
		border-radius: var(--radius-sm, 4px);
		background: #fff;
		color: var(--color-text-secondary, #555);
		cursor: pointer;
	}
	.graph-btn:hover {
		background: var(--color-panel-bg, #f9fafb);
	}

	.hint {
		position: absolute;
		bottom: 0.4rem;
		right: 0.6rem;
		font-size: var(--font-size-xs, 0.75rem);
		color: var(--color-text-quiet, #888);
		pointer-events: none;
	}

	.notice {
		position: absolute;
		top: 0.5rem;
		left: 0.6rem;
		font-size: var(--font-size-xs, 0.75rem);
		color: var(--color-text-muted, #777);
		background: rgba(255, 255, 255, 0.85);
		padding: 0.15rem 0.4rem;
		border-radius: var(--radius-sm, 4px);
		pointer-events: none;
	}

	.node-tooltip {
		position: absolute;
		z-index: 20;
		pointer-events: none;
		background: #fff;
		border: 1px solid var(--color-border, #ccc);
		border-radius: var(--radius-md, 6px);
		box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
		padding: 0.4rem 0.55rem;
		max-width: 260px;
	}
	.nt-label {
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--color-text, #222);
		overflow-wrap: anywhere;
	}
	.nt-meta {
		font-size: 0.72rem;
		color: var(--color-text-muted, #777);
	}

	.state-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		background: rgba(252, 252, 253, 0.75);
		pointer-events: none;
	}
	.state-msg {
		margin: 0;
		font-size: var(--font-size-sm, 0.85rem);
		color: var(--color-text-secondary, #555);
	}
	.state-msg.error {
		color: var(--color-error, #c00);
	}
	.state-bar {
		width: 220px;
		height: 4px;
		border-radius: 2px;
		background: var(--color-border-light, #e5e7eb);
		overflow: hidden;
	}
	.state-bar-fill {
		height: 100%;
		background: var(--color-primary, #2563eb);
		transform-origin: 0 50%;
	}
</style>
