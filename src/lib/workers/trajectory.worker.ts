/// <reference lib="webworker" />

/**
 * Trajectory computation Web Worker.
 *
 * Receives a `TrajectoryWorkerRequest`, constructs strategy and schedule
 * from their ids/configs, calls `computeTrajectory`, and posts the result
 * back transferring the `ArrayBuffer`.
 *
 * For the `lexical` strategy, an `EditDistanceModel` + `NeighborhoodProvider`
 * is built lazily per tokenizer (decoding all $K$ token strings once, then
 * computing neighborhoods on-demand during the walk). The model/provider
 * pair is cached in the worker for the lifetime of the tokenizer.
 *
 * Progress is posted in two phases: `'preparing'` while decoding the
 * vocabulary (chunked and yielding, so messages go out immediately) and
 * `'walking'` for the noise walk itself. Posts are throttled to at most
 * one per ~100 ms so fast runs send few or none.
 */

import { computeTrajectory } from '../engine/trajectory.js';
import { createRng } from '../engine/rng.js';
import { getStrategy } from '../strategies/index.js';
import { getSchedule } from '../schedules/index.js';
import { loadTokenizer } from '../tokenizers/index.js';
import { EditDistanceModel } from '../strategies/distance-model.js';
import { CharOverlapModel } from '../strategies/char-overlap-model.js';
import type { CharOverlapMode } from '../strategies/char-overlap-model.js';
import { NeighborhoodProvider } from '../strategies/neighborhood.js';
import type { Tokenizer } from '../tokenizers/types.js';
import type {
	TrajectoryWorkerRequest,
	TrajectoryWorkerResponse,
	TrajectoryWorkerPhase,
} from './trajectory.protocol.js';
import { buildNeighborGraph } from '../strategies/neighbor-graph.js';
import type { NeighborGraphParams } from '../strategies/neighbor-graph.js';
import { buildUnionGraph } from '../engine/union-graph.js';
import { computeForceLayoutLarge } from '../engine/force-layout.js';
import type { TrajectoryWorkerUnionGraphRequest, UnionGraph } from './trajectory.protocol.js';

/** Latest union-graph request id; older requests abort at checkpoints. */
let latestUnionRequestId = 0;

/** Hard cap on union-graph nodes (neighborhood shrinks to fit). */
const UNION_MAX_NODES = 20_000;

/** Max neighborhood nodes kept per anchor in the union graph. */
const UNION_MAX_PER_ANCHOR = 8;

/** Layout iterations for the union graph (chunked for progress). */
const UNION_LAYOUT_ITERATIONS = 300;

/** Minimum interval between progress posts (ms). */
const PROGRESS_INTERVAL_MS = 100;

/**
 * Fixed radius ceiling for the lexical neighborhood provider.
 * All neighbors within this edit distance are cached; $k$ and
 * `maxDistance` (≤ R_MAX) are applied at read time in the strategy.
 */
const R_MAX = 3;

/**
 * Fixed radius ceiling for the char-overlap neighborhood provider.
 * Jaccard distance $d = 1 - J \in [0,1]$, and the UI lets `maxDistance`
 * reach 1, so the ceiling is 1 (any token sharing a character).
 */
const R_MAX_CHAR = 1.0;

/**
 * Nearest neighbors kept per token by both providers. Reads take at most
 * the top $k$ within `maxDistance`, and the UI caps $k$ at 200, so this
 * bound leaves every read unchanged while keeping per-token memory fixed.
 */
const NEIGHBOR_STORE_LIMIT = 200;

/**
 * Cached model/provider pair per tokenizer id.
 * The model decodes all $K$ strings once; the provider memoizes
 * per-token neighborhoods computed on first visit during the walk.
 */
const _lexicalCache = new Map<
	string,
	{ model: EditDistanceModel; provider: NeighborhoodProvider }
>();

/**
 * Cached model/provider pair per tokenizer id for char-overlap.
 * Keyed by `${tokenizerId}:${mode}` so set and multiset don't collide.
 */
const _charOverlapCache = new Map<
	string,
	{ model: CharOverlapModel; provider: NeighborhoodProvider }
>();

/** Callback reporting decoded-token count and vocabulary size. */
type VocabProgress = (done: number, total: number) => void;

/**
 * Decode all $K$ token strings, in chunks of 4096, yielding to the event
 * loop between chunks so progress messages can be delivered.
 */
async function decodeVocab(tok: Tokenizer, onProgress?: VocabProgress): Promise<string[]> {
	const K = tok.vocabSize;
	const strings: string[] = [];
	const CHUNK = 4096;
	for (let offset = 0; offset < K; offset += CHUNK) {
		const end = Math.min(offset + CHUNK, K);
		const ids = new Int32Array(end - offset);
		for (let i = offset; i < end; i++) ids[i - offset] = i;
		const raw = tok.idsToTokens(ids);
		for (const r of raw) {
			strings.push(r);
		}
		onProgress?.(end, K);
		// Yield to the event loop.
		await new Promise((r) => setTimeout(r, 0));
	}
	return strings;
}

/**
 * Ensure the EditDistanceModel + NeighborhoodProvider are ready for a
 * tokenizer. Decodes all $K$ token strings (one-time cost per tokenizer
 * lifetime), builds the model, and wraps it in a provider.
 */
async function ensureLexicalProvider(
	tokenizerId: string,
	onProgress?: VocabProgress,
): Promise<NeighborhoodProvider> {
	const cached = _lexicalCache.get(tokenizerId);
	if (cached) return cached.provider;

	const tok = await loadTokenizer(tokenizerId);
	const strings = await decodeVocab(tok, onProgress);

	const model = new EditDistanceModel(strings);
	const provider = new NeighborhoodProvider(model, R_MAX, { maxStored: NEIGHBOR_STORE_LIMIT });
	_lexicalCache.set(tokenizerId, { model, provider });
	return provider;
}

/**
 * Ensure the CharOverlapModel + NeighborhoodProvider are ready for a
 * tokenizer. Decodes all $K$ token strings (one-time cost per tokenizer
 * lifetime), builds the model, and wraps it in a provider.
 */
async function ensureCharOverlapProvider(
	tokenizerId: string,
	mode: CharOverlapMode,
	onProgress?: VocabProgress,
): Promise<NeighborhoodProvider> {
	const cacheKey = `${tokenizerId}:${mode}`;
	const cached = _charOverlapCache.get(cacheKey);
	if (cached) return cached.provider;

	const tok = await loadTokenizer(tokenizerId);
	const strings = await decodeVocab(tok, onProgress);

	const model = new CharOverlapModel(strings, mode);
	const provider = new NeighborhoodProvider(model, R_MAX_CHAR, { maxStored: NEIGHBOR_STORE_LIMIT });
	_charOverlapCache.set(cacheKey, { model, provider });
	return provider;
}

self.onmessage = (event: MessageEvent<TrajectoryWorkerRequest>) => {
	const msg = event.data;
	if (msg.kind === 'compute') {
		void handleCompute(msg);
	} else if (msg.kind === 'neighbors') {
		void handleNeighbors(msg);
	} else if (msg.kind === 'union-graph') {
		void handleUnionGraph(msg);
	}
};

/** Handle a trajectory compute request. */
async function handleCompute(
	msg: Extract<TrajectoryWorkerRequest, { kind: 'compute' }>,
): Promise<void> {
	const { requestId, spec } = msg;

	// Time-throttled progress posting: at most one message per
	// PROGRESS_INTERVAL_MS, so fast runs post few or none. The final
	// report is always forced through so the bar completes.
	let lastPost = performance.now();
	const postProgress = (
		phase: TrajectoryWorkerPhase,
		step: number,
		total: number,
		force = false,
	): void => {
		const now = performance.now();
		if (!force && now - lastPost < PROGRESS_INTERVAL_MS) return;
		lastPost = now;
		const response: TrajectoryWorkerResponse = { kind: 'progress', requestId, phase, step, total };
		self.postMessage(response);
	};

	try {
		// For lexical: build (or reuse) the neighborhood provider.
		let provider: NeighborhoodProvider | undefined;
		if (spec.strategyId === 'lexical') {
			provider = await ensureLexicalProvider(spec.tokenizerId, (done, total) =>
				postProgress('preparing', done, total),
			);
		} else if (spec.strategyId === 'char-overlap') {
			const mode = (spec.strategyConfig as { mode?: CharOverlapMode }).mode ?? 'set';
			provider = await ensureCharOverlapProvider(spec.tokenizerId, mode, (done, total) =>
				postProgress('preparing', done, total),
			);
		}

		const strategy = getStrategy(spec.strategyId, spec.strategyConfig, spec.vocabSize, provider);
		const schedule = getSchedule(spec.scheduleId, spec.scheduleConfig, spec.T);
		const rng = createRng(spec.seed);

		const traj = computeTrajectory(spec.inputIds, { strategy, schedule, rng }, (progress) => {
			postProgress('walking', progress.cellsDone, progress.cellsTotal);
		});

		postProgress('walking', spec.T * spec.inputIds.length, spec.T * spec.inputIds.length, true);

		const response: TrajectoryWorkerResponse = {
			kind: 'result',
			requestId,
			rows: traj.rows,
			T: traj.T,
			length: traj.length,
			seed: spec.seed,
		};

		// Transfer the ArrayBuffer to avoid copying.
		self.postMessage(response, { transfer: [traj.rows.buffer] });
	} catch (e: unknown) {
		const response: TrajectoryWorkerResponse = {
			kind: 'error',
			requestId,
			message: e instanceof Error ? e.message : String(e),
		};
		self.postMessage(response);
	}
}

/**
 * Handle an inspection-graph query for the hover tooltip.
 *
 * Builds the strategy instance (reusing the cached provider for
 * neighborhood strategies) and evaluates exact transition probabilities
 * $Q_s(x_{s+1} \mid x_s)$ along the supplied trajectory column. The
 * graph always contains the trajectory; `hasNeighborhood` is `false` for
 * strategies without neighborhood support (uniform) or when no neighbors
 * are in range — the UI distinguishes these from hard errors.
 */
async function handleNeighbors(
	msg: Extract<TrajectoryWorkerRequest, { kind: 'neighbors' }>,
): Promise<void> {
	const {
		requestId,
		tokenizerId,
		strategyId,
		strategyConfig,
		vocabSize,
		column,
		betas,
		limitMode,
		k,
		p,
	} = msg;

	try {
		let provider: NeighborhoodProvider | undefined;
		let graphParams: NeighborGraphParams | null = null;

		if (strategyId === 'lexical') {
			provider = await ensureLexicalProvider(tokenizerId);
			const cfg = strategyConfig as { maxDistance?: number; k?: number; tau?: number };
			graphParams = {
				maxDistance: cfg.maxDistance ?? 2,
				k: cfg.k ?? 50,
				tau: cfg.tau ?? 1.0,
			};
		} else if (strategyId === 'char-overlap') {
			const mode = (strategyConfig as { mode?: 'set' | 'multiset' }).mode ?? 'set';
			provider = await ensureCharOverlapProvider(tokenizerId, mode);
			const cfg = strategyConfig as { maxDistance?: number; k?: number; tau?: number };
			graphParams = {
				maxDistance: cfg.maxDistance ?? 0.5,
				k: cfg.k ?? 50,
				tau: cfg.tau ?? 1.0,
			};
		}

		const strategy = getStrategy(strategyId, strategyConfig, vocabSize, provider);
		const tok = await loadTokenizer(tokenizerId);
		const graph = buildNeighborGraph(
			strategy,
			provider ?? null,
			graphParams,
			column,
			betas,
			{ limitMode, k, p },
			(id) => tok.idsToTokens(new Int32Array([id]))[0] ?? `#${id}`,
		);

		const response: TrajectoryWorkerResponse = {
			kind: 'neighbors',
			requestId,
			graph,
		};
		self.postMessage(response);
	} catch (e: unknown) {
		const response: TrajectoryWorkerResponse = {
			kind: 'neighbors-error',
			requestId,
			message: e instanceof Error ? e.message : String(e),
		};
		self.postMessage(response);
	}
}

/**
 * Handle a union-graph build for the full-graph view.
 *
 * Builds the token-space union of all position trajectories (plus the
 * 1-hop neighborhood for strategies with a provider, reusing the cached
 * provider) and lays it out with the large force layout. Both phases
 * are chunked so progress messages go out and superseded requests abort
 * at checkpoints. The rows buffer arrives transferred (the store sends a
 * copy), so the worker owns it for the duration of the build.
 */
async function handleUnionGraph(msg: TrajectoryWorkerUnionGraphRequest): Promise<void> {
	latestUnionRequestId = msg.requestId;
	const { requestId, tokenizerId, strategyId, strategyConfig, vocabSize, rows, T, L } = msg;
	const isStale = () => latestUnionRequestId !== requestId;

	let lastPost = performance.now();
	const postProgress = (phase: 'neighbors' | 'layout', step: number, total: number): void => {
		if (isStale()) return;
		const now = performance.now();
		if (now - lastPost < PROGRESS_INTERVAL_MS && step < total) return;
		lastPost = now;
		const response: TrajectoryWorkerResponse = {
			kind: 'union-graph-progress',
			requestId,
			phase,
			step,
			total,
		};
		self.postMessage(response);
	};
	/** Cooperative yield for progress delivery + stale checks. */
	const yieldFn = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

	try {
		let provider: NeighborhoodProvider | undefined;
		let graphParams: NeighborGraphParams | null = null;

		if (strategyId === 'lexical') {
			provider = await ensureLexicalProvider(tokenizerId);
			const cfg = strategyConfig as { maxDistance?: number; k?: number; tau?: number };
			graphParams = {
				maxDistance: cfg.maxDistance ?? 2,
				k: cfg.k ?? 50,
				tau: cfg.tau ?? 1.0,
			};
		} else if (strategyId === 'char-overlap') {
			const mode = (strategyConfig as { mode?: CharOverlapMode }).mode ?? 'set';
			provider = await ensureCharOverlapProvider(tokenizerId, mode);
			const cfg = strategyConfig as { maxDistance?: number; k?: number; tau?: number };
			graphParams = {
				maxDistance: cfg.maxDistance ?? 0.5,
				k: cfg.k ?? 50,
				tau: cfg.tau ?? 1.0,
			};
		}
		if (isStale()) return;

		const tok = await loadTokenizer(tokenizerId);
		if (isStale()) return;
		const labelOf = (id: number): string =>
			id === vocabSize ? '[MASK]' : (tok.idsToTokens(new Int32Array([id]))[0] ?? `#${id}`);

		postProgress('neighbors', 0, 1);
		const built = await buildUnionGraph({
			rows,
			T,
			L,
			maskId: vocabSize,
			provider: provider ?? null,
			params: graphParams,
			limits: {
				limitMode: msg.limitMode,
				k: msg.k,
				p: msg.p,
				maxPerAnchor: UNION_MAX_PER_ANCHOR,
				maxNodes: UNION_MAX_NODES,
			},
			labelOf,
			onProgress: (done, total) => postProgress('neighbors', done, total),
			yieldFn,
			shouldAbort: isStale,
		});
		if (isStale()) return;

		// Layout, chunked for progress + aborts. Continuation chunks pass
		// the previous positions back as `initial`.
		const n = built.nodeCount;
		postProgress('layout', 0, UNION_LAYOUT_ITERATIONS);
		const chunk = 25;
		let layout = computeForceLayoutLarge(n, built.edgeSrc, built.edgeDst, null, {
			iterations: chunk,
			initial: { x: built.initX, y: built.initY },
			dampTotal: UNION_LAYOUT_ITERATIONS,
		});
		for (let done = chunk; done < UNION_LAYOUT_ITERATIONS; done += chunk) {
			if (isStale()) return;
			postProgress('layout', done, UNION_LAYOUT_ITERATIONS);
			await yieldFn();
			layout = computeForceLayoutLarge(n, built.edgeSrc, built.edgeDst, null, {
				iterations: Math.min(chunk, UNION_LAYOUT_ITERATIONS - done),
				initial: layout,
				iterationOffset: done,
				dampTotal: UNION_LAYOUT_ITERATIONS,
			});
		}
		postProgress('layout', UNION_LAYOUT_ITERATIONS, UNION_LAYOUT_ITERATIONS);
		if (isStale()) return;

		const graph: UnionGraph = {
			nodeCount: built.nodeCount,
			T: built.T,
			ids: built.ids,
			trajStep: built.trajStep,
			revealStep: built.revealStep,
			labels: built.labels,
			edgeSrc: built.edgeSrc,
			edgeDst: built.edgeDst,
			edgeFirstStep: built.edgeFirstStep,
			edgeCount: built.edgeCount,
			edgeTraj: built.edgeTraj,
			hasNeighborhood: built.hasNeighborhood,
			truncated: built.truncated,
			layoutX: layout.x,
			layoutY: layout.y,
		};

		const response: TrajectoryWorkerResponse = { kind: 'union-graph', requestId, graph };
		self.postMessage(response, {
			transfer: [
				built.ids.buffer,
				built.trajStep.buffer,
				built.revealStep.buffer,
				built.edgeSrc.buffer,
				built.edgeDst.buffer,
				built.edgeFirstStep.buffer,
				built.edgeCount.buffer,
				built.edgeTraj.buffer,
				layout.x.buffer,
				layout.y.buffer,
			] as unknown as Transferable[],
		});
	} catch (e: unknown) {
		if (isStale()) return; // superseded: drop silently
		const response: TrajectoryWorkerResponse = {
			kind: 'union-graph-error',
			requestId,
			message: e instanceof Error ? e.message : String(e),
		};
		self.postMessage(response);
	}
}
