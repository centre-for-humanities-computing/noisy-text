<script lang="ts">
	import { onMount } from 'svelte';
	import TokenChips from '$lib/components/TokenChips.svelte';
	import InlineTokens from '$lib/components/InlineTokens.svelte';
	import InputBar from '$lib/components/InputBar.svelte';
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
	import { charOverlapStore } from '$lib/stores/charOverlap.svelte.js';
	import { viewStore } from '$lib/stores/view.svelte.js';
	import { TOKENIZERS } from '$lib/tokenizers/index.js';
	import { STRATEGIES } from '$lib/strategies/index.js';
	import { strategyConfigFor } from '$lib/strategies/index.js';
	import { SCHEDULES } from '$lib/schedules/index.js';
	import { recencyAt, tokenCharRanges } from '$lib/engine/diff.js';
	import LexicalParams from '$lib/components/LexicalParams.svelte';
	import CharOverlapParams from '$lib/components/CharOverlapParams.svelte';

	let text = $state(
		'Governments of the Industrial World, you weary giants of flesh and steel, I come from Cyberspace, the new home of Mind. On behalf of the future, I ask you of the past to leave us alone. You are not welcome among us. You have no sovereignty where we gather.\n\nWe have no elected government, nor are we likely to have one, so I address you with no greater authority than that with which liberty itself always speaks. I declare the global social space we are building to be naturally independent of the tyrannies you seek to impose on us. You have no moral right to rule us nor do you possess any methods of enforcement we have true reason to fear.\n\nGovernments derive their just powers from the consent of the governed. You have neither solicited nor received ours. We did not invite you. You do not know us, nor do you know our world. Cyberspace does not lie within your borders. Do not think that you can build it, as though it were a public construction project. You cannot. It is an act of nature and it grows itself through our collective actions.',
	);

	const showChips = $derived(viewStore.display === 'chips');

	const tokenizerOptions = $derived(Object.values(TOKENIZERS));
	const strategyOptions = $derived(Object.values(STRATEGIES));
	const scheduleOptions = $derived(Object.values(SCHEDULES));

	// Captions for the Tokenizer and Strategy pickers, sourced from registry info.
	const tokenizerCaption = $derived.by(() => {
		const t = tokenizerStore.tokenizer;
		return t ? t.info.description : '';
	});
	const strategyCaption = $derived.by(() => {
		const info = strategyStore.info;
		return info ? info.description : '';
	});

	const canStep = $derived(
		(trajectoryStore.status === 'ready' || trajectoryStore.status === 'computing') &&
			scheduleStore.T > 0,
	);

	function handleKeydown(e: KeyboardEvent) {
		// Ignore when focus is inside a text input, textarea, or select.
		const tag = (e.target as HTMLElement).tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
		if (!canStep) return;

		if (e.key === 'ArrowLeft') {
			e.preventDefault();
			const next = trajectoryStore.t - 1;
			if (next >= 0) trajectoryStore.t = next;
		} else if (e.key === 'ArrowRight') {
			e.preventDefault();
			const next = trajectoryStore.t + 1;
			if (next <= scheduleStore.T) trajectoryStore.t = next;
		}
	}

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

	// Reusable buffer for recencyAt to avoid allocation on every tick.
	const _recencyBuf = new Float32Array(2048);

	// The decoded text for the current step (prose view).
	const decodedText = $derived.by(() => {
		const tok = tokenizerStore.tokenizer;
		if (!tok || displayTokens.ids.length === 0) return '';
		const maskTokenId = tok.vocabSize;
		const filtered = new Int32Array(displayTokens.ids.filter((id) => id !== maskTokenId));
		if (filtered.length === 0) return '';
		return tok.decode(filtered);
	});

	// Character-level changed ranges with recency for prose taper.
	// Uses token boundaries to constrain character spans: each token's
	// recency (from recencyAt) is mapped to its character span in the
	// decoded string by decoding tokens individually.
	const charRanges = $derived.by(() => {
		const tok = tokenizerStore.tokenizer;
		if (!tok || tokenRecency.length === 0) return [];
		const ids = displayTokens.ids;
		const maskTokenId = tok.vocabSize;
		return tokenCharRanges(
			ids,
			tokenRecency,
			(id) => tok.decode(new Int32Array([id])),
			maskTokenId,
		);
	});

	// Per-token recency for chip fade.
	const tokenRecency = $derived.by(() => {
		const traj = trajectoryStore.trajectory;
		if (!traj || traj.length === 0) return new Float32Array(0);
		const t = trajectoryStore.t;
		const L = traj.length;
		if (L > _recencyBuf.length) {
			return recencyAt(traj, t, viewStore.taperWindow);
		}
		return recencyAt(traj, t, viewStore.taperWindow, _recencyBuf);
	});

	// Changed count: positions with recency === 1 (changed this step).
	const changedCount = $derived.by(() => {
		const r = tokenRecency;
		if (r.length === 0) return null;
		let n = 0;
		for (let i = 0; i < r.length; i++) {
			if (r[i] === 1) n++;
		}
		return n;
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
				strategyStore.currentId === 'lexical'
					? lexicalStore.params
					: strategyStore.currentId === 'char-overlap'
						? charOverlapStore.params
						: undefined,
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

	// Mark lexical and char-overlap stores ready when tokenizer is available.
	$effect(() => {
		if (tokenizerStore.tokenizer) {
			lexicalStore.markReady();
			charOverlapStore.markReady();
		}
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<main>
	<h1>noisy-text</h1>

	{#if viewStore.mode === 'edit'}
		<!-- ===== EDIT MODE ===== -->
		<p class="intro">Paste some text, then watch it dissolve through a noise process.</p>

		<div class="edit-pickers">
			<div class="picker-group">
				<TokenizerPicker
					value={tokenizerStore.currentId}
					options={tokenizerOptions}
					disabled={tokenizerStore.status === 'loading'}
					onchange={(id) => tokenizerStore.selectTokenizer(id)}
				/>
				{#if tokenizerCaption}
					<p class="caption">{tokenizerCaption}</p>
				{/if}
			</div>
			<div class="picker-group">
				<StrategyPicker
					value={strategyStore.currentId}
					options={strategyOptions}
					disabled={tokenizerStore.status !== 'ready'}
					onchange={(id) =>
						strategyStore.selectStrategy(id, tokenizerStore.tokenizer?.vocabSize ?? 0)}
				/>
				{#if strategyCaption}
					<p class="caption">{strategyCaption}</p>
				{/if}
			</div>
		</div>

		<textarea bind:value={text} placeholder="Type or paste text here…" rows={8}></textarea>

		<button
			class="noise-btn"
			disabled={tokenizerStore.status !== 'ready' || text.trim().length === 0}
			onclick={() => {
				viewStore.mode = 'explore';
			}}
		>
			Noise it &rarr;
		</button>
	{:else}
		<!-- ===== EXPLORE MODE ===== -->
		<InputBar
			{text}
			onedit={() => {
				viewStore.mode = 'edit';
			}}
		/>

		{#if displayTokens.tokens.length > 0}
			<div class="tokens-area" class:computing={isComputing}>
				{#if showChips}
					<TokenChips
						tokens={displayTokens.tokens}
						ids={displayTokens.ids}
						recency={tokenRecency}
					/>
				{:else}
					<InlineTokens text={decodedText} ranges={charRanges} />
				{/if}
			</div>
		{/if}

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

		<div class="control-strip">
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
				onchange={(id) =>
					strategyStore.selectStrategy(id, tokenizerStore.tokenizer?.vocabSize ?? 0)}
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
					viewStore.display = v ? 'chips' : 'prose';
				}}
			/>
			<button
				class="advanced-toggle"
				class:active={viewStore.advancedOpen}
				onclick={() => {
					viewStore.advancedOpen = !viewStore.advancedOpen;
				}}
			>
				⚙ Advanced
			</button>
		</div>

		{#if viewStore.advancedOpen}
			<div class="advanced-panel">
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

				{#if strategyStore.currentId === 'char-overlap'}
					<CharOverlapParams
						minSimilarity={charOverlapStore.minSimilarity}
						k={charOverlapStore.k}
						epsilon={charOverlapStore.epsilon}
						mode={charOverlapStore.mode}
						disabled={tokenizerStore.status !== 'ready'}
						onminsimilaritychange={(v) => (charOverlapStore.minSimilarity = v)}
						onkchange={(v) => (charOverlapStore.k = v)}
						onepsilonchange={(v) => (charOverlapStore.epsilon = v)}
						onmodechange={(v) => (charOverlapStore.mode = v)}
					/>
				{/if}

				<SchedulePlot schedule={scheduleStore.instance} />
			</div>
		{/if}
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

	/* Edit mode */
	.intro {
		margin: 0 0 1.25rem;
		color: #555;
		font-size: 0.95rem;
	}
	.edit-pickers {
		display: flex;
		flex-wrap: wrap;
		gap: 1.5rem;
		margin-bottom: 1rem;
	}
	.picker-group {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.caption {
		margin: 0;
		font-size: 0.8rem;
		color: #777;
		max-width: 320px;
	}
	.noise-btn {
		display: block;
		margin: 1rem 0 0;
		padding: 0.6rem 1.5rem;
		font-size: 1rem;
		font-weight: 600;
		border: none;
		border-radius: 6px;
		background: #2563eb;
		color: #fff;
		cursor: pointer;
	}
	.noise-btn:hover:not(:disabled) {
		background: #1d4ed8;
	}
	.noise-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	/* Explore mode */
	.control-strip {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.75rem;
		font-size: 0.85rem;
		color: #666;
	}
	.advanced-toggle {
		font-size: 0.8rem;
		padding: 0.2rem 0.5rem;
		border: 1px solid #ccc;
		border-radius: 4px;
		background: #fff;
		cursor: pointer;
		color: #555;
	}
	.advanced-toggle:hover {
		background: #eee;
	}
	.advanced-toggle.active {
		background: #e0e7ff;
		border-color: #2563eb;
		color: #2563eb;
	}
	.advanced-panel {
		margin-top: 0.75rem;
		padding: 0.75rem;
		border: 1px solid #e5e7eb;
		border-radius: 6px;
		background: #f9fafb;
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
		margin-bottom: 0.5rem;
		resize: vertical;
	}
	.tokens-area {
		transition: opacity 0.15s;
	}
	.tokens-area.computing {
		opacity: 0.5;
	}
</style>
