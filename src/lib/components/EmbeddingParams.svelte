<script lang="ts">
	import InfoTooltip from './InfoTooltip.svelte';
	import { KERNEL_CAPTION, KERNEL_TOOLTIP, TAU_TOOLTIP, FAMILY_TOOLTIP } from './kernel-help.js';
	import { EMBEDDING_SOURCES, METRICS, PREPROCESSINGS } from '$lib/embeddings/index.js';
	type EmbeddingSourceId = keyof typeof EMBEDDING_SOURCES;

	interface Props {
		sourceId: EmbeddingSourceId;
		preprocess: keyof typeof PREPROCESSINGS;
		metric: keyof typeof METRICS;
		tokenClass: 'any' | 'word-initial' | 'continuation';
		excludeSpecial: boolean;
		excludeUnused: boolean;
		excludeByteFallback: boolean;
		k: number;
		epsilon: number;
		tau: number;
		family: 'exponential' | 'power-law' | 'gaussian';
		disabled: boolean;
		onsourcechange: (v: EmbeddingSourceId) => void;
		onpreprocesschange: (v: keyof typeof PREPROCESSINGS) => void;
		onmetricchange: (v: keyof typeof METRICS) => void;
		ontokenclasschange: (v: Props['tokenClass']) => void;
		onexcludespecialchange: (v: boolean) => void;
		onexcludeunusedchange: (v: boolean) => void;
		onexcludebytefallbackchange: (v: boolean) => void;
		onkchange: (v: number) => void;
		onepsilonchange: (v: number) => void;
		ontauchange: (v: number) => void;
		onfamilychange: (v: Props['family']) => void;
	}

	let {
		sourceId,
		preprocess,
		metric,
		tokenClass,
		excludeSpecial,
		excludeUnused,
		excludeByteFallback,
		k,
		epsilon,
		tau,
		family,
		disabled,
		onsourcechange,
		onpreprocesschange,
		onmetricchange,
		ontokenclasschange,
		onexcludespecialchange,
		onexcludeunusedchange,
		onexcludebytefallbackchange,
		onkchange,
		onepsilonchange,
		ontauchange,
		onfamilychange,
	}: Props = $props();
</script>

<div class="embedding-params">
	<div class="param-grid">
		<label>
			<span>Source</span>
			<select
				{disabled}
				value={sourceId}
				onchange={(e) => onsourcechange(e.currentTarget.value as EmbeddingSourceId)}
			>
				{#each Object.values(EMBEDDING_SOURCES) as s (s.id)}
					<option value={s.id}>{s.label}</option>
				{/each}
			</select>
		</label>

		<label>
			<span>Preprocessing</span>
			<select
				{disabled}
				value={preprocess}
				onchange={(e) => onpreprocesschange(e.currentTarget.value as keyof typeof PREPROCESSINGS)}
			>
				{#each Object.values(PREPROCESSINGS) as p (p.id)}
					<option value={p.id}>{p.label}</option>
				{/each}
			</select>
		</label>

		<label>
			<span>Metric</span>
			<select
				{disabled}
				value={metric}
				onchange={(e) => onmetricchange(e.currentTarget.value as keyof typeof METRICS)}
			>
				{#each Object.values(METRICS) as m (m.id)}
					<option value={m.id}>{m.label}</option>
				{/each}
			</select>
		</label>

		<label>
			<span>Token class</span>
			<select
				{disabled}
				value={tokenClass}
				onchange={(e) => ontokenclasschange(e.currentTarget.value as Props['tokenClass'])}
			>
				<option value="any">Any</option>
				<option value="word-initial">Word-initial</option>
				<option value="continuation">Continuation</option>
			</select>
		</label>

		<label class="check">
			<input
				type="checkbox"
				checked={excludeSpecial}
				{disabled}
				onchange={(e) => onexcludespecialchange(e.currentTarget.checked)}
			/>
			<span>No specials</span>
		</label>

		<label class="check">
			<input
				type="checkbox"
				checked={excludeUnused}
				{disabled}
				onchange={(e) => onexcludeunusedchange(e.currentTarget.checked)}
			/>
			<span>No unused</span>
		</label>

		<label class="check">
			<input
				type="checkbox"
				checked={excludeByteFallback}
				{disabled}
				onchange={(e) => onexcludebytefallbackchange(e.currentTarget.checked)}
			/>
			<span>No byte-fallback</span>
		</label>

		<label>
			<span>Top-k</span>
			<input
				type="range"
				min={1}
				max={200}
				step={1}
				value={k}
				{disabled}
				oninput={(e) => onkchange(Number(e.currentTarget.value))}
			/>
			<span class="param-value">{k}</span>
		</label>

		<label>
			<span>Floor ε</span>
			<input
				type="range"
				min={0}
				max={0.5}
				step={0.005}
				value={epsilon}
				{disabled}
				oninput={(e) => onepsilonchange(Number(e.currentTarget.value))}
			/>
			<span class="param-value">{epsilon.toFixed(3)}</span>
		</label>

		<label>
			<span>τ <InfoTooltip text={TAU_TOOLTIP.text} math={TAU_TOOLTIP.math} /></span>
			<input
				type="range"
				min={0.05}
				max={5}
				step={0.05}
				value={tau}
				{disabled}
				oninput={(e) => ontauchange(Number(e.currentTarget.value))}
			/>
			<span class="param-value">{tau.toFixed(2)}</span>
		</label>

		<label>
			<span>Family <InfoTooltip text={FAMILY_TOOLTIP.text} math={FAMILY_TOOLTIP.math} /></span>
			<select
				{disabled}
				value={family}
				onchange={(e) => onfamilychange(e.currentTarget.value as Props['family'])}
			>
				<option value="exponential">Exponential</option>
				<option value="power-law">Power law</option>
				<option value="gaussian">Gaussian</option>
			</select>
		</label>
	</div>

	<p class="kernel-caption">
		{KERNEL_CAPTION}
		<InfoTooltip text={KERNEL_TOOLTIP.text} math={KERNEL_TOOLTIP.math} />
	</p>
</div>

<style>
	.embedding-params {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.param-grid {
		display: flex;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.param-grid label {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.8rem;
	}

	.param-grid label.check {
		gap: 0.25rem;
	}

	.param-value {
		min-width: 2.5rem;
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.kernel-caption {
		font-size: var(--font-size-xs);
		color: var(--color-text-quiet);
		margin: 0;
	}
</style>
