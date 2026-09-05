<script lang="ts">
	import { onMount } from 'svelte';
	import TokenChips from '$lib/components/TokenChips.svelte';
	import InlineTokens from '$lib/components/InlineTokens.svelte';
	import TokenizerPicker from '$lib/components/TokenizerPicker.svelte';
	import StrategyPicker from '$lib/components/StrategyPicker.svelte';
	import SchedulePicker from '$lib/components/SchedulePicker.svelte';
	import SchedulePlot from '$lib/components/SchedulePlot.svelte';
	import SeedControl from '$lib/components/SeedControl.svelte';
	import TimeSlider from '$lib/components/TimeSlider.svelte';
	import DisplayModeToggle from '$lib/components/DisplayModeToggle.svelte';
	import { tokenizerStore } from '$lib/stores/tokenizer.svelte.js';
	import { strategyStore } from '$lib/stores/strategy.svelte.js';
	import { scheduleStore } from '$lib/stores/schedule.svelte.js';
	import { trajectoryStore } from '$lib/stores/trajectory.svelte.js';
	import { lexicalStore } from '$lib/stores/lexical.svelte.js';
	import { TOKENIZERS } from '$lib/tokenizers/index.js';
	import { STRATEGIES } from '$lib/strategies/index.js';
	import { strategyConfigFor } from '$lib/strategies/index.js';
	import { SCHEDULES } from '$lib/schedules/index.js';
	import { changedMask } from '$lib/engine/diff.js';
	import LexicalParams from '$lib/components/LexicalParams.svelte';

	let text = $state('Hello, world!');
	let showChips = $state(true);

	const tokenizerOptions = $derived(Object.values(TOKENIZERS));
	const strategyOptions = $derived(Object.values(STRATEGIES));
	const scheduleOptions = $derived(Object.values(SCHEDULES));

	const encoded = $derived.by(() => {
		const t = tokenizerStore.tokenizer;
		if (!t || text.length === 0) return { ids: new Int32Array(0), tokens: [] as readonly string[] };
		const ids = t.encode(text);
		const tokens = t.idsToTokens(ids);
		return { ids, tokens };
	});

	// Tokens to display: trajectory at current $t$ if ready, otherwise encoded input.
	// Sentinel mask ids (=== vocabSize) are replaced with the literal "[MASK]" label
	// since they are out of range for the tokenizer's idsToTokens.
	const displayTokens = $derived.by(() => {
		const traj = trajectoryStore.trajectory;
		const tok = tokenizerStore.tokenizer;
		if (!tok) return { ids: new Int32Array(0), tokens: [] as readonly string[] };
		if (traj && traj.length > 0) {
			const ids = traj.tokensAt(trajectoryStore.t);
			return _renderTokens(ids, tok);
		}
		return encoded;
	});

	/**
	 * Build display tokens, replacing sentinel mask ids with "[MASK]".
	 * The sentinel id (vocabSize) is out of range for idsToTokens, so we
	 * substitute it with 0 before calling the tokenizer, then patch the
	 * result.
	 */
	function _renderTokens(
		ids: Int32Array,
		tok: import('$lib/tokenizers/types.js').Tokenizer,
	): { ids: Int32Array; tokens: readonly string[] } {
		const maskTokenId = tok.vocabSize;
		// Build a copy with mask positions replaced by 0 (a safe real id).
		const safe = new Int32Array(ids.length);
		for (let i = 0; i < ids.length; i++) {
			safe[i] = ids[i] === maskTokenId ? 0 : ids[i]!;
		}
		const tokens = tok.idsToTokens(safe);
		// Patch mask positions.
		const patched = tokens.map((t, i) => (ids[i] === maskTokenId ? '[MASK]' : t));
		return { ids, tokens: patched };
	}

	// Reusable buffer for changedMask to avoid allocation on every tick.
	const _maskBuf = new Uint8Array(2048);

	// Changed mask: which tokens differ from the previous timestep $x_{t-1}$.
	// At $t=0$ there is no previous step, so the mask is all zeros.
	// Returns null when no trajectory is ready.
	const changed = $derived.by(() => {
		const traj = trajectoryStore.trajectory;
		if (!traj || traj.length === 0) return null;
		const t = trajectoryStore.t;
		if (t === 0) {
			// Nothing changed from "before t=0".
			const empty = new Uint8Array(traj.length);
			return empty;
		}
		const prev = traj.tokensAt(t - 1);
		const curr = traj.tokensAt(t);
		if (curr.length > _maskBuf.length) {
			return changedMask(prev, curr);
		}
		return changedMask(prev, curr, _maskBuf);
	});

	// Changed count (null when no trajectory is ready).
	const changedCount = $derived.by(() => {
		if (!changed) return null;
		let n = 0;
		for (let i = 0; i < changed.length; i++) {
			if (changed[i] === 1) n++;
		}
		return n;
	});

	const decodedText = $derived.by(() => {
		const tok = tokenizerStore.tokenizer;
		if (!tok || displayTokens.ids.length === 0) return '';
		// Filter out sentinel mask ids so they render invisibly.
		const maskTokenId = tok.vocabSize;
		const filtered = new Int32Array(displayTokens.ids.filter((id) => id !== maskTokenId));
		if (filtered.length === 0) return '';
		return tok.decode(filtered);
	});

	const statusText = $derived.by(() => {
		const s = tokenizerStore.status;
		if (s === 'loading') return 'Loading tokenizer…';
		if (s === 'error') return `Error: ${tokenizerStore.error ?? 'unknown'}`;
		if (s === 'ready' && tokenizerStore.tokenizer) {
			const t = tokenizerStore.tokenizer;
			const info = strategyStore.info;
			const strategyLabel = info ? ` · Strategy: ${info.label}` : '';
			const trajStatus = trajectoryStore.status === 'computing' ? ' · Computing trajectory…' : '';
			const changedPart = changedCount !== null ? ` · ${changedCount} changed this step` : '';
			return `${t.info.label} · Vocab: ${t.vocabSize.toLocaleString()} · Tokens: ${encoded.ids.length}${strategyLabel}${trajStatus}${changedPart}`;
		}
		return 'Select a tokenizer';
	});

	const isComputing = $derived(trajectoryStore.status === 'computing');

	// When the tokenizer becomes ready, instantiate the selected strategy
	// with the current vocab size. Re-instantiates on tokenizer or strategy change.
	$effect(() => {
		const t = tokenizerStore.tokenizer;
		if (t) {
			strategyStore.selectStrategy(strategyStore.currentId, t.vocabSize);
		}
	});

	// Instantiate the schedule on mount and re-instantiate on id or T change.
	// Schedules are independent of tokenizer/strategy.
	$effect(() => {
		scheduleStore.selectSchedule(scheduleStore.currentId);
	});

	// Request trajectory computation whenever inputs change.
	$effect(() => {
		const ids = encoded.ids;
		const tok = tokenizerStore.tokenizer;
		if (!tok || ids.length === 0) return;

		trajectoryStore.request({
			inputIds: ids,
			strategyId: strategyStore.currentId,
			strategyConfig: strategyConfigFor(
				strategyStore.currentId,
				tok.vocabSize,
				strategyStore.currentId === 'lexical' ? lexicalStore.params : undefined,
			),
			scheduleId: scheduleStore.currentId,
			scheduleConfig: {},
			T: scheduleStore.T,
			vocabSize: tok.vocabSize,
			seed: trajectoryStore.seed,
			tokenizerId: tokenizerStore.currentId,
		});
	});

	onMount(() => {
		tokenizerStore.selectTokenizer('gpt2');
	});

	// Mark lexical store ready when tokenizer is available.
	$effect(() => {
		if (tokenizerStore.tokenizer) {
			lexicalStore.markReady();
		}
	});
</script>

<main>
	<h1>noisy-text</h1>

	<div class="controls">
		<TokenizerPicker
			value={tokenizerStore.currentId}
			options={tokenizerOptions}
			disabled={tokenizerStore.status === 'loading'}
			onchange={(id) => tokenizerStore.selectTokenizer(id)}
		/>
		<StrategyPicker
			value={strategyStore.currentId}
			options={strategyOptions}
			disabled={tokenizerStore.status !== 'ready'}
			onchange={(id) => strategyStore.selectStrategy(id, tokenizerStore.tokenizer?.vocabSize ?? 0)}
		/>
		<SchedulePicker
			value={scheduleStore.currentId}
			options={scheduleOptions}
			disabled={false}
			T={scheduleStore.T}
			onchange={(id) => scheduleStore.selectSchedule(id)}
			onTchange={(n) => scheduleStore.setT(n)}
		/>
		<SeedControl
			seed={trajectoryStore.seed}
			disabled={tokenizerStore.status !== 'ready'}
			onseedchange={(s) => {
				trajectoryStore.seed = s;
			}}
			onreroll={() => trajectoryStore.reroll()}
		/>
		<DisplayModeToggle
			{showChips}
			disabled={trajectoryStore.status !== 'ready'}
			onchange={(v) => {
				showChips = v;
			}}
		/>
	</div>

	{#if strategyStore.currentId === 'lexical'}
		<LexicalParams
			maxDistance={lexicalStore.maxDistance}
			k={lexicalStore.k}
			epsilon={lexicalStore.epsilon}
			disabled={tokenizerStore.status !== 'ready'}
			onmaxdistancechange={(v) => (lexicalStore.maxDistance = v)}
			onkchange={(v) => (lexicalStore.k = v)}
			onepsilonchange={(v) => (lexicalStore.epsilon = v)}
		/>
	{/if}

	<SchedulePlot schedule={scheduleStore.instance} />

	<TimeSlider
		t={trajectoryStore.t}
		T={scheduleStore.T}
		disabled={trajectoryStore.status !== 'ready' && trajectoryStore.status !== 'computing'}
		ontchange={(t) => {
			trajectoryStore.t = t;
		}}
	/>

	<div class="status" class:error={tokenizerStore.status === 'error'}>
		{#if isComputing}
			<span class="throbber" aria-hidden="true"></span>
		{/if}
		{statusText}
	</div>

	<textarea bind:value={text} placeholder="Type or paste text here…" rows={6}></textarea>

	{#if displayTokens.tokens.length > 0}
		<div class="tokens-area" class:computing={isComputing}>
			{#if showChips}
				<TokenChips
					tokens={displayTokens.tokens}
					ids={displayTokens.ids}
					changed={changed ?? new Uint8Array(0)}
				/>
			{:else}
				<InlineTokens text={decodedText} />
			{/if}
		</div>
	{/if}
</main>

<style>
	main {
		max-width: 960px;
		margin: 0 auto;
		padding: 1.5rem;
		font-family: system-ui, sans-serif;
	}
	h1 {
		margin: 0 0 1rem;
		font-size: 1.25rem;
	}
	.controls {
		margin-bottom: 0.5rem;
	}
	.status {
		font-size: 0.85rem;
		color: #555;
		margin-bottom: 0.75rem;
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}
	.status.error {
		color: #c00;
	}
	.throbber {
		display: inline-block;
		width: 12px;
		height: 12px;
		border: 2px solid #ccc;
		border-top-color: #555;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
		flex-shrink: 0;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	textarea {
		width: 100%;
		box-sizing: border-box;
		font-family: monospace;
		font-size: 0.95rem;
		padding: 0.5rem;
		margin-bottom: 1rem;
		resize: vertical;
	}
	.tokens-area {
		transition: opacity 0.15s;
	}
	.tokens-area.computing {
		opacity: 0.5;
	}
</style>
