<script lang="ts">
	import type { Schedule } from '$lib/schedules/types.js';

	interface Props {
		schedule: Schedule<unknown> | null;
	}

	let { schedule }: Props = $props();

	// SVG dimensions
	const WIDTH = 400;
	const HEIGHT = 120;
	const PAD_LEFT = 40;
	const PAD_RIGHT = 10;
	const PAD_TOP = 10;
	const PAD_BOTTOM = 20;
	const PLOT_W = WIDTH - PAD_LEFT - PAD_RIGHT;
	const PLOT_H = HEIGHT - PAD_TOP - PAD_BOTTOM;

	// Compute polyline points for beta_t only (pedagogical: focus on per-step rate).
	const betaPoints = $derived.by(() => {
		if (!schedule) return '';
		const T = schedule.T;
		const pts: string[] = [];
		for (let t = 0; t < T; t++) {
			const x = PAD_LEFT + (t / (T - 1)) * PLOT_W;
			const y = PAD_TOP + (1 - schedule.beta(t)) * PLOT_H;
			pts.push(`${x},${y}`);
		}
		return pts.join(' ');
	});
</script>

{#if schedule}
	<figure class="schedule-plot" aria-label="Noise schedule: beta over time">
		<svg viewBox="0 0 {WIDTH} {HEIGHT}">
			<!-- Y-axis -->
			<line
				x1={PAD_LEFT}
				y1={PAD_TOP}
				x2={PAD_LEFT}
				y2={PAD_TOP + PLOT_H}
				stroke="#ccc"
				stroke-width="1"
			/>
			<!-- X-axis -->
			<line
				x1={PAD_LEFT}
				y1={PAD_TOP + PLOT_H}
				x2={PAD_LEFT + PLOT_W}
				y2={PAD_TOP + PLOT_H}
				stroke="#ccc"
				stroke-width="1"
			/>
			<!-- Y-axis labels -->
			<text x={PAD_LEFT - 4} y={PAD_TOP + 4} text-anchor="end" font-size="8" fill="#888">1</text>
			<text x={PAD_LEFT - 4} y={PAD_TOP + PLOT_H + 4} text-anchor="end" font-size="8" fill="#888"
				>0</text
			>
			<!-- X-axis labels -->
			<text x={PAD_LEFT} y={PAD_TOP + PLOT_H + 14} text-anchor="middle" font-size="8" fill="#888"
				>0</text
			>
			<text
				x={PAD_LEFT + PLOT_W}
				y={PAD_TOP + PLOT_H + 14}
				text-anchor="middle"
				font-size="8"
				fill="#888">T</text
			>
			<!-- beta_t -->
			<polyline points={betaPoints} fill="none" stroke="#377eb8" stroke-width="1.5" />
			<!-- Legend -->
			<line
				x1={PAD_LEFT + 4}
				y1={PAD_TOP + PLOT_H - 14}
				x2={PAD_LEFT + 20}
				y2={PAD_TOP + PLOT_H - 14}
				stroke="#377eb8"
				stroke-width="1.5"
			/>
			<text x={PAD_LEFT + 24} y={PAD_TOP + PLOT_H - 11} font-size="8" fill="#333">βₜ</text>
		</svg>
		<figcaption class="plot-caption">
			At each step, this fraction of tokens is eligible for corruption. The schedule controls how
			aggressively the noise ramps up.
		</figcaption>
	</figure>
{/if}

<style>
	.schedule-plot {
		margin: 0;
	}
	.schedule-plot svg {
		display: block;
		max-width: 100%;
		height: auto;
		border: 1px solid var(--color-border-lighter);
		border-radius: var(--radius-sm);
		background: var(--color-surface);
	}
	.plot-caption {
		margin: 0.35rem 0 0;
		font-size: var(--font-size-xs);
		color: var(--color-text-muted);
		line-height: 1.4;
	}
</style>
