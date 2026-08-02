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

	// Compute polyline points for beta_t and cumulative noise (1 - alpha_bar_t).
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

	const cumPoints = $derived.by(() => {
		if (!schedule) return '';
		const T = schedule.T;
		const pts: string[] = [];
		for (let t = 0; t < T; t++) {
			const x = PAD_LEFT + (t / (T - 1)) * PLOT_W;
			// Cumulative noise = 1 - alpha_bar_t
			const y = PAD_TOP + (1 - schedule.cumulative(t)) * PLOT_H;
			pts.push(`${x},${y}`);
		}
		return pts.join(' ');
	});
</script>

{#if schedule}
	<svg viewBox="0 0 {WIDTH} {HEIGHT}" class="schedule-plot" aria-label="Noise schedule plot">
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
		<!-- Cumulative noise (1 - alpha_bar_t) -->
		<polyline points={cumPoints} fill="none" stroke="#e41a1c" stroke-width="1.5" />
		<!-- beta_t -->
		<polyline points={betaPoints} fill="none" stroke="#377eb8" stroke-width="1.5" />
		<!-- Legend -->
		<line
			x1={PAD_LEFT + 4}
			y1={PAD_TOP + PLOT_H - 14}
			x2={PAD_LEFT + 20}
			y2={PAD_TOP + PLOT_H - 14}
			stroke="#e41a1c"
			stroke-width="1.5"
		/>
		<text x={PAD_LEFT + 24} y={PAD_TOP + PLOT_H - 11} font-size="8" fill="#333">1 − ᾱₜ</text>
		<line
			x1={PAD_LEFT + 80}
			y1={PAD_TOP + PLOT_H - 14}
			x2={PAD_LEFT + 96}
			y2={PAD_TOP + PLOT_H - 14}
			stroke="#377eb8"
			stroke-width="1.5"
		/>
		<text x={PAD_LEFT + 100} y={PAD_TOP + PLOT_H - 11} font-size="8" fill="#333">βₜ</text>
	</svg>
{/if}

<style>
	.schedule-plot {
		display: block;
		max-width: 100%;
		height: auto;
		border: 1px solid #e0e0e0;
		border-radius: 4px;
		background: #fafafa;
	}
</style>
