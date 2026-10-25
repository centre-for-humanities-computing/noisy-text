<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import TokenChips from '$lib/components/TokenChips.svelte';
	import InlineTokens from '$lib/components/InlineTokens.svelte';
	import InputBar from '$lib/components/InputBar.svelte';
	import TokenizerPicker from '$lib/components/TokenizerPicker.svelte';
	import StrategyPicker from '$lib/components/StrategyPicker.svelte';
	import SchedulePicker from '$lib/components/SchedulePicker.svelte';
	import SeedControl from '$lib/components/SeedControl.svelte';
	import TimeSlider from '$lib/components/TimeSlider.svelte';
	import ViewToggle from '$lib/components/ViewToggle.svelte';
	import FullGraph from '$lib/components/FullGraph.svelte';
	import { tokenizerStore } from '$lib/stores/tokenizer.svelte.js';
	import { strategyStore } from '$lib/stores/strategy.svelte.js';
	import { scheduleStore } from '$lib/stores/schedule.svelte.js';
	import { trajectoryStore } from '$lib/stores/trajectory.svelte.js';
	import { graphStore } from '$lib/stores/graph.svelte.js';
	import { lexicalStore } from '$lib/stores/lexical.svelte.js';
	import { charOverlapStore } from '$lib/stores/charOverlap.svelte.js';
	import { embeddingStore } from '$lib/stores/embedding.svelte.js';
	import { viewStore } from '$lib/stores/view.svelte.js';
	import { TOKENIZERS } from '$lib/tokenizers/index.js';
	import { STRATEGIES } from '$lib/strategies/index.js';
	import { strategyConfigFor } from '$lib/strategies/index.js';
	import { EMBEDDING_SOURCES } from '$lib/embeddings/index.js';
	import { SCHEDULES } from '$lib/schedules/index.js';
	import { recencyAt, allTokenCharSpans } from '$lib/engine/diff.js';
	import EmbeddingSourcePicker from '$lib/components/EmbeddingSourcePicker.svelte';
	import LexicalParams from '$lib/components/LexicalParams.svelte';
	import CharOverlapParams from '$lib/components/CharOverlapParams.svelte';
	import EmbeddingParams from '$lib/components/EmbeddingParams.svelte';
	import ScheduleParams from '$lib/components/ScheduleParams.svelte';
	import BetaReadout from '$lib/components/BetaReadout.svelte';
	import AdvancedPanel from '$lib/components/AdvancedPanel.svelte';
	import TokenTooltip from '$lib/components/TokenTooltip.svelte';
	import { inspectionStore } from '$lib/stores/inspection.svelte.js';
	import { hashIds } from '$lib/engine/trajectory-cache.js';
	import type { NeighborGraph } from '$lib/workers/trajectory.protocol.js';

	let text = $state(
		'Governments of the Industrial World, you weary giants of flesh and steel, I come from Cyberspace, the new home of Mind. On behalf of the future, I ask you of the past to leave us alone. You are not welcome among us. You have no sovereignty where we gather.\n\nWe have no elected government, nor are we likely to have one, so I address you with no greater authority than that with which liberty itself always speaks. I declare the global social space we are building to be naturally independent of the tyrannies you seek to impose on us. You have no moral right to rule us nor do you possess any methods of enforcement we have true reason to fear.\n\nGovernments derive their just powers from the consent of the governed. You have neither solicited nor received ours. We did not invite you. You do not know us, nor do you know our world. Cyberspace does not lie within your borders. Do not think that you can build it, as though it were a public construction project. You cannot. It is an act of nature and it grows itself through our collective actions.',
	);

	/**
	 * Strategy config for the active strategy, with the tokenizer's vocab
	 * size. Shared by the trajectory, union-graph, and inspection requests.
	 */
	function activeStrategyConfig(vocabSize: number): Record<string, unknown> {
		const id = strategyStore.currentId;
		return strategyConfigFor(
			id,
			vocabSize,
			id === 'lexical'
				? lexicalStore.params
				: id === 'char-overlap'
					? charOverlapStore.params
					: id === 'embedding-knn'
						? embeddingStore.params
						: undefined,
		) as Record<string, unknown>;
	}

	/**
	 * The embedding-knn strategy pins the tokenizer: embedding rows are
	 * indexed by the source model's own vocabulary. True while it is the
	 * active strategy.
	 */
	const tokenizerLocked = $derived(strategyStore.currentId === 'embedding-knn');

	/**
	 * Cache key for the union-graph build. Hashing the rows *content*
	 * (not the spec) keeps the cache correct even while a new trajectory
	 * is being computed after an edit.
	 */
	const unionKey = $derived.by(() => {
		const traj = trajectoryStore.trajectory;
		if (!traj) return '';
		const tok = tokenizerStore.tokenizer;
		if (!tok) return '';
		const config = activeStrategyConfig(trajectoryStore.vocabSize);
		return [
			tokenizerStore.currentId,
			strategyStore.currentId,
			JSON.stringify(config),
			hashIds(traj.rows),
			inspectionStore.limitMode,
			inspectionStore.k,
			inspectionStore.p,
		].join('|');
	});

	// Lazily build the union graph when the graph view is active. The store
	// call is untracked: its reads of store state must not re-run this effect.
	$effect(() => {
		if (viewStore.display !== 'graph') return;
		if (trajectoryStore.status !== 'ready') return;
		const tok = tokenizerStore.tokenizer;
		const traj = trajectoryStore.trajectory;
		const key = unionKey;
		if (!tok || !traj || !key) return;
		const req = {
			tokenizerId: tokenizerStore.currentId,
			strategyId: strategyStore.currentId,
			strategyConfig: activeStrategyConfig(trajectoryStore.vocabSize),
			vocabSize: trajectoryStore.vocabSize,
			oovTokens: tokenizerStore.tokenizer?.oovTokens ?? [],
			rows: traj.rows,
			T: traj.T,
			L: traj.length,
			limitMode: inspectionStore.limitMode,
			k: inspectionStore.k,
			p: inspectionStore.p,
			key,
		};
		untrack(() => graphStore.request(req));
	});

	const tokenizerOptions = $derived(Object.values(TOKENIZERS));
	// Hidden strategies (e.g. identity) only appear when debug mode is on.
	const strategyOptions = $derived(
		Object.values(STRATEGIES).filter((s) => viewStore.debug || !s.hidden),
	);
	const scheduleOptions = $derived(Object.values(SCHEDULES));

	// Captions for the Tokenizer and Strategy pickers, sourced from registry info.
	const tokenizerCaption = $derived.by(() => {
		const t = tokenizerStore.tokenizer;
		return t ? t.info.gloss : '';
	});
	const strategyCaption = $derived.by(() => {
		const info = strategyStore.info;
		return info ? info.gloss : '';
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
		if (!t || text.length === 0)
			return { ids: new Int32Array(0), tokens: [] as readonly string[], vocabSize: 0 };
		const { ids, vocabSize } = t.encode(text);
		const tokens = t.idsToTokens(ids);
		return { ids, tokens, vocabSize };
	});

	/**
	 * Mask sentinel for the tokens currently displayed: the displayed
	 * trajectory's own $K_{\text{eff}}$, or the encoded input's when no
	 * trajectory is shown yet. An older trajectory keeps its own sentinel
	 * while a replacement is computing.
	 */
	const displayVocabSize = $derived(
		trajectoryStore.trajectory ? trajectoryStore.vocabSize : encoded.vocabSize,
	);

	// Tokens to display: trajectory at current $t$ if ready, otherwise encoded input.
	// Sentinel mask ids (=== vocabSize) are replaced with the literal "[MASK]" label
	// since they are out of range for the tokenizer's idsToTokens.
	const displayTokens = $derived.by(() => {
		const traj = trajectoryStore.trajectory;
		const tok = tokenizerStore.tokenizer;
		if (!tok) return { ids: new Int32Array(0), tokens: [] as readonly string[] };
		if (traj && traj.length > 0) {
			const ids = traj.tokensAt(trajectoryStore.t);
			return _renderTokens(ids, tok, displayVocabSize);
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
		vocabSize: number,
	): { ids: Int32Array; tokens: readonly string[] } {
		const maskTokenId = vocabSize;
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

	// Per-token recency for chip fade. No reusable buffer: recencyAt would
	// return the same Float32Array reference every time, and Svelte's derived
	// equality check would skip downstream updates (e.g. changedCount).
	const tokenRecency = $derived.by(() => {
		const traj = trajectoryStore.trajectory;
		if (!traj || traj.length === 0) return new Float32Array(0);
		return recencyAt(traj, trajectoryStore.t, viewStore.taperWindow);
	});

	// The decoded text for the current step (prose view).
	const decodedText = $derived.by(() => {
		const tok = tokenizerStore.tokenizer;
		if (!tok || displayTokens.ids.length === 0) return '';
		const maskTokenId = displayVocabSize;
		const filtered = new Int32Array(displayTokens.ids.filter((id) => id !== maskTokenId));
		if (filtered.length === 0) return '';
		return tok.decode(filtered);
	});

	// Per-token character spans for the prose view (hover + taper).
	const tokenSpans = $derived.by(() => {
		const tok = tokenizerStore.tokenizer;
		if (!tok || displayTokens.ids.length === 0) return [];
		const maskTokenId = displayVocabSize;
		return allTokenCharSpans(
			displayTokens.ids,
			tokenRecency,
			(id) => tok.decode(new Int32Array([id])),
			maskTokenId,
			decodedText,
			tok.info.wordPiece,
		);
	});

	// ===== Token inspector (hover tooltip) =====

	type HoverState = {
		tokenId: number;
		x: number;
		y: number;
		status: 'loading' | 'ready' | 'error' | 'unavailable';
		graph: NeighborGraph | null;
	};

	let hover: HoverState | null = $state(null);
	/** Monotonic id to ignore stale neighbor-query results. */
	let hoverQueryId = 0;

	/**
	 * Handle token hover from either view: record the anchor, then query
	 * the worker for the inspection graph (trajectory + 1-hop neighborhood).
	 *
	 * Works for every strategy: neighborhood strategies (lexical,
	 * char-overlap) also get the 1-hop neighborhood; others (identity,
	 * uniform, absorbing) get the trajectory only.
	 */
	function handleTokenHover(tokenId: number, index: number, rect: DOMRect): void {
		const tok = tokenizerStore.tokenizer;
		const traj = trajectoryStore.trajectory;
		if (!tok || !traj) return;

		hover = { tokenId, x: rect.left, y: rect.top, status: 'loading', graph: null };

		// Trajectory column for this position: $x_0, \ldots, x_t$. The rows
		// buffer is flat $(T+1) \times L$, so gather position `index` per step.
		const t = trajectoryStore.t;
		const L = traj.length;
		const column = new Int32Array(t + 1);
		for (let s = 0; s <= t; s++) column[s] = traj.rows[s * L + index]!;
		// Schedule $\beta$ values for the steps taken so far.
		const schedule = scheduleStore.instance;
		const betas = new Float32Array(t);
		for (let s = 0; s < t; s++) betas[s] = schedule ? schedule.beta(s) : 0;

		const queryId = ++hoverQueryId;
		trajectoryStore
			.queryNeighbors({
				tokenizerId: tokenizerStore.currentId,
				strategyId: strategyStore.currentId,
				strategyConfig: activeStrategyConfig(trajectoryStore.vocabSize),
				vocabSize: trajectoryStore.vocabSize,
				oovTokens: tokenizerStore.tokenizer?.oovTokens ?? [],
				column,
				betas,
				limitMode: inspectionStore.limitMode,
				k: inspectionStore.k,
				p: inspectionStore.p,
			})
			.then((graph) => {
				// Ignore stale results (mouse moved to another token).
				if (queryId !== hoverQueryId || !hover || hover.tokenId !== tokenId) return;
				hover = { tokenId, x: hover.x, y: hover.y, status: 'ready', graph };
			})
			.catch(() => {
				if (queryId !== hoverQueryId || !hover || hover.tokenId !== tokenId) return;
				hover = { tokenId, x: hover.x, y: hover.y, status: 'error', graph: null };
			});
	}

	function handleTokenUnhover(): void {
		hoverQueryId++;
		hover = null;
	}

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

	// Trajectory computation status suffix for the status line:
	// phase label + percentage once a phase is known (+ elapsed seconds
	// after the first second).
	const trajStatus = $derived.by(() => {
		if (trajectoryStore.status !== 'computing') return '';
		const phase = trajectoryStore.phase;
		const label =
			phase === 'preparing'
				? 'Preparing vocabulary'
				: phase === 'materializing'
					? 'Preparing vectors'
					: phase === 'embeddings'
						? 'Computing embedding neighbours'
						: 'Computing trajectory';
		const pctPart = phase !== null ? ` ${Math.round(trajectoryStore.progress * 100)}%` : '';
		const elapsedPart =
			trajectoryStore.elapsed >= 1 ? ` (${trajectoryStore.elapsed.toFixed(1)}s)` : '';
		return ` · ${label}…${pctPart}${elapsedPart}`;
	});

	const progressPct = $derived(Math.round(trajectoryStore.progress * 100));

	const statusText = $derived.by(() => {
		const s = tokenizerStore.status;
		if (s === 'loading') {
			const progress = tokenizerStore.progress;
			return progress !== null
				? `Loading tokenizer… ${Math.round(progress * 100)}%`
				: 'Loading tokenizer…';
		}
		if (s === 'error') return `Error: ${tokenizerStore.error ?? 'unknown'}`;
		if (s === 'ready' && tokenizerStore.tokenizer) {
			const t = tokenizerStore.tokenizer;
			const info = strategyStore.info;
			const strategyLabel = info ? ` · Strategy: ${info.label}` : '';
			const changedPart = changedCount !== null ? ` · ${changedCount} changed this step` : '';
			const oovPart =
				encoded.vocabSize > t.vocabSize ? ` (+${encoded.vocabSize - t.vocabSize} OOV seen)` : '';
			return `${t.info.label} · Vocab: ${encoded.vocabSize.toLocaleString()}${oovPart} · Tokens: ${encoded.ids.length}${strategyLabel}${trajStatus}${changedPart}`;
		}
		return 'Select a tokenizer';
	});

	const isComputing = $derived(trajectoryStore.status === 'computing');

	// When the tokenizer becomes ready, instantiate the selected strategy
	// with the current vocab size. Re-instantiates on tokenizer or strategy change.
	$effect(() => {
		const t = tokenizerStore.tokenizer;
		if (t) {
			strategyStore.selectStrategy(strategyStore.currentId, encoded.vocabSize);
		}
	});

	// Instantiate the schedule on mount and re-instantiate on id or T change.
	// Schedules are independent of tokenizer/strategy.
	$effect(() => {
		scheduleStore.selectSchedule(scheduleStore.currentId);
	});

	// Request trajectory computation whenever inputs change. The store call is
	// untracked: a cache hit clamps `t`, and that read must not re-run this
	// effect on every slider move.
	$effect(() => {
		const ids = encoded.ids;
		const tok = tokenizerStore.tokenizer;
		if (!tok || ids.length === 0) return;

		const spec = {
			inputIds: ids,
			strategyId: strategyStore.currentId,
			strategyConfig: activeStrategyConfig(encoded.vocabSize),
			scheduleId: scheduleStore.currentId,
			scheduleConfig: scheduleStore.config,
			T: scheduleStore.T,
			vocabSize: encoded.vocabSize,
			seed: trajectoryStore.seed,
			tokenizerId: tokenizerStore.currentId,
		};
		untrack(() => trajectoryStore.request(spec));
	});

	onMount(() => {
		tokenizerStore.selectTokenizer('gpt2');
	});

	// Mark param stores ready when tokenizer is available.
	$effect(() => {
		if (tokenizerStore.tokenizer) {
			lexicalStore.markReady();
			charOverlapStore.markReady();
		}
	});

	// Keep the tokenizer aligned with the embedding source's vocabulary
	// whenever the embedding-knn strategy is active.
	$effect(() => {
		if (strategyStore.currentId !== 'embedding-knn') return;
		const want = EMBEDDING_SOURCES[embeddingStore.sourceId].tokenizerId;
		if (tokenizerStore.currentId !== want) {
			tokenizerStore.selectTokenizer(want);
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
					disabled={tokenizerStore.status === 'loading' || tokenizerLocked}
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
					onchange={(id) => strategyStore.selectStrategy(id, encoded.vocabSize)}
				/>
				{#if strategyCaption}
					<p class="caption">{strategyCaption}</p>
				{/if}
			</div>
			{#if strategyStore.currentId === 'embedding-knn'}
				<div class="picker-group">
					<EmbeddingSourcePicker
						value={embeddingStore.sourceId}
						disabled={tokenizerStore.status !== 'ready'}
						onchange={(id) => (embeddingStore.sourceId = id)}
					/>
				</div>
			{/if}
		</div>

		<textarea
			bind:value={text}
			placeholder="Type or paste text here…"
			rows={8}
			data-testid="input-text"
		></textarea>

		<button
			class="noise-btn"
			data-testid="noise-button"
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
			<div class="tokens-wrap">
				<div class="view-bar">
					<ViewToggle
						value={viewStore.display}
						disabled={trajectoryStore.status !== 'ready'}
						onchange={(v) => {
							viewStore.display = v;
						}}
					/>
				</div>
				{#if isComputing}
					<div
						class="traj-progress"
						role="progressbar"
						aria-label="Computing trajectory"
						aria-valuemin="0"
						aria-valuemax="100"
						aria-valuenow={trajectoryStore.phase === 'walking' ? progressPct : undefined}
					>
						<div
							class="traj-progress-fill"
							class:indeterminate={trajectoryStore.phase !== 'walking'}
							style:transform={`scaleX(${trajectoryStore.progress})`}
						></div>
					</div>
				{/if}
				<div class="tokens-area" class:computing={isComputing} data-testid="output">
					{#if viewStore.display === 'chips'}
						<TokenChips
							tokens={displayTokens.tokens}
							ids={displayTokens.ids}
							recency={tokenRecency}
							onhover={handleTokenHover}
							onunhover={handleTokenUnhover}
						/>
					{:else if viewStore.display === 'graph'}
						<FullGraph
							graph={graphStore.graph}
							status={graphStore.status}
							progress={graphStore.progress}
							phase={graphStore.phase}
							error={graphStore.error}
							traj={trajectoryStore.trajectory}
							t={trajectoryStore.t}
							taperWindow={viewStore.taperWindow}
						/>
					{:else}
						<InlineTokens
							text={decodedText}
							spans={tokenSpans}
							onhover={handleTokenHover}
							onunhover={handleTokenUnhover}
						/>
					{/if}
				</div>
			</div>
		{/if}

		{#if hover}
			<TokenTooltip x={hover.x} y={hover.y} state={hover.status} graph={hover.graph} />
		{/if}

		<TimeSlider
			t={trajectoryStore.t}
			T={scheduleStore.T}
			disabled={trajectoryStore.status !== 'ready' && trajectoryStore.status !== 'computing'}
			ontchange={(t) => {
				trajectoryStore.t = t;
			}}
			onTchange={(n) => scheduleStore.setT(n)}
		/>

		<BetaReadout t={trajectoryStore.t} schedule={scheduleStore.instance} />

		<div
			class="status"
			class:error={tokenizerStore.status === 'error'}
			data-testid="app-status"
			data-trajectory-status={trajectoryStore.status}
		>
			{#if isComputing}
				<span class="throbber" aria-hidden="true"></span>
			{/if}
			{statusText}
		</div>

		<div class="control-strip">
			<TokenizerPicker
				value={tokenizerStore.currentId}
				options={tokenizerOptions}
				disabled={tokenizerStore.status === 'loading' || tokenizerLocked}
				onchange={(id) => tokenizerStore.selectTokenizer(id)}
			/>
			<StrategyPicker
				value={strategyStore.currentId}
				options={strategyOptions}
				disabled={tokenizerStore.status !== 'ready'}
				onchange={(id) => strategyStore.selectStrategy(id, encoded.vocabSize)}
			/>
			{#if strategyStore.currentId === 'embedding-knn'}
				<EmbeddingSourcePicker
					value={embeddingStore.sourceId}
					disabled={tokenizerStore.status !== 'ready'}
					onchange={(id) => (embeddingStore.sourceId = id)}
				/>
			{/if}
			<SchedulePicker
				value={scheduleStore.currentId}
				options={scheduleOptions}
				disabled={false}
				onchange={(id) => scheduleStore.selectSchedule(id)}
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
			<div class="advanced-region">
				<SeedControl
					seed={trajectoryStore.seed}
					disabled={tokenizerStore.status !== 'ready'}
					onseedchange={(s) => {
						trajectoryStore.seed = s;
					}}
					onreroll={() => trajectoryStore.reroll()}
				/>
				<ScheduleParams
					multiplier={scheduleStore.multiplier}
					disabled={false}
					onmultiplierchange={(v) => scheduleStore.setMultiplier(v)}
				/>
				{#if strategyStore.currentId === 'lexical'}
					<LexicalParams
						maxDistance={lexicalStore.maxDistance}
						k={lexicalStore.k}
						epsilon={lexicalStore.epsilon}
						tau={lexicalStore.tau}
						family={lexicalStore.family}
						disabled={tokenizerStore.status !== 'ready'}
						onmaxdistancechange={(v) => (lexicalStore.maxDistance = v)}
						onkchange={(v) => (lexicalStore.k = v)}
						onepsilonchange={(v) => (lexicalStore.epsilon = v)}
						ontauchange={(v) => (lexicalStore.tau = v)}
						onfamilychange={(v) => (lexicalStore.family = v)}
					/>
				{/if}

				{#if strategyStore.currentId === 'char-overlap'}
					<CharOverlapParams
						minSimilarity={charOverlapStore.minSimilarity}
						k={charOverlapStore.k}
						epsilon={charOverlapStore.epsilon}
						tau={charOverlapStore.tau}
						family={charOverlapStore.family}
						mode={charOverlapStore.mode}
						disabled={tokenizerStore.status !== 'ready'}
						onminsimilaritychange={(v) => (charOverlapStore.minSimilarity = v)}
						onkchange={(v) => (charOverlapStore.k = v)}
						onepsilonchange={(v) => (charOverlapStore.epsilon = v)}
						ontauchange={(v) => (charOverlapStore.tau = v)}
						onfamilychange={(v) => (charOverlapStore.family = v)}
						onmodechange={(v) => (charOverlapStore.mode = v)}
					/>
				{/if}

				{#if strategyStore.currentId === 'embedding-knn'}
					<EmbeddingParams
						preprocess={embeddingStore.preprocess}
						metric={embeddingStore.metric}
						tokenClass={embeddingStore.tokenClass}
						excludeSpecial={embeddingStore.excludeSpecial}
						excludeUnused={embeddingStore.excludeUnused}
						excludeByteFallback={embeddingStore.excludeByteFallback}
						k={embeddingStore.k}
						epsilon={embeddingStore.epsilon}
						tau={embeddingStore.tau}
						family={embeddingStore.family}
						disabled={tokenizerStore.status !== 'ready'}
						onpreprocesschange={(v) => (embeddingStore.preprocess = v)}
						onmetricchange={(v) => (embeddingStore.metric = v)}
						ontokenclasschange={(v) => (embeddingStore.tokenClass = v)}
						onexcludespecialchange={(v) => (embeddingStore.excludeSpecial = v)}
						onexcludeunusedchange={(v) => (embeddingStore.excludeUnused = v)}
						onexcludebytefallbackchange={(v) => (embeddingStore.excludeByteFallback = v)}
						onkchange={(v) => (embeddingStore.k = v)}
						onepsilonchange={(v) => (embeddingStore.epsilon = v)}
						ontauchange={(v) => (embeddingStore.tau = v)}
						onfamilychange={(v) => (embeddingStore.family = v)}
					/>
				{/if}

				<AdvancedPanel
					schedule={scheduleStore.instance}
					strategyInfo={strategyStore.info}
					limitMode={inspectionStore.limitMode}
					k={inspectionStore.k}
					p={inspectionStore.p}
					debug={viewStore.debug}
					ondebugchange={(v) => {
						viewStore.debug = v;
						// If debug is turned off while a hidden strategy is active,
						// fall back to uniform so the picker never shows a value
						// with no visible card.
						if (!v && strategyStore.info?.hidden) {
							strategyStore.selectStrategy('uniform', encoded.vocabSize);
						}
					}}
					onlimitmodechange={(m) => (inspectionStore.limitMode = m)}
					onkchange={(v) => (inspectionStore.k = v)}
					onpchange={(v) => (inspectionStore.p = v)}
				/>
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
	.advanced-region {
		margin-top: 0.75rem;
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
	.tokens-wrap {
		position: relative;
	}
	/* Bar above the tokens area: the three-way Prose | Chips | Graph
	   toggle, right-aligned so it reads as a lens over the output. */
	.view-bar {
		display: flex;
		justify-content: flex-end;
		margin-bottom: 0.4rem;
	}
	.tokens-area {
		transition: opacity 0.15s;
	}
	.tokens-area.computing {
		opacity: 0.5;
	}
	/* Thin bar floating in the gap above the tokens area. Determinate while
	   walking; a shimmer while preparing (or before the first progress
	   message). Fades in after 250ms so quick or cached runs never flash it. */
	.traj-progress {
		position: absolute;
		top: -0.75rem;
		left: 0;
		right: 0;
		height: 3px;
		border-radius: 2px;
		background: #e5e7eb;
		overflow: hidden;
		animation: progress-in 0.2s ease 0.25s backwards;
	}
	.traj-progress-fill {
		height: 100%;
		background: #2563eb;
		transform-origin: 0 50%;
		transition: transform 0.15s linear;
	}
	/* Indeterminate phase: the running animation overrides the inline
	   scaleX transform (animations outrank inline styles in the cascade). */
	.traj-progress-fill.indeterminate {
		width: 33%;
		animation: progress-shimmer 1.2s ease-in-out infinite;
	}
	@keyframes progress-in {
		from {
			opacity: 0;
		}
	}
	@keyframes progress-shimmer {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(400%);
		}
	}
</style>
