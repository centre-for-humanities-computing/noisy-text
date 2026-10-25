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
 * For `embedding-knn`, after loading the matrix the kNN index is
 * materialized into a contiguous row matrix (phase `'materializing'`),
 * the input rows are precomputed (phase `'embeddings'`), and a budgeted
 * BFS over the kNN graph warms the reachable set — so repeat runs and
 * later walk steps mostly hit memory or the IndexedDB cache.
 *
 * Progress is posted in the phases `'preparing'` (vocabulary decode,
 * chunked and yielding so messages go out immediately),
 * `'materializing'` (flat-matrix build), `'embeddings'` (neighbour rows)
 * and `'walking'` (the noise walk itself). Posts are throttled to at most
 * one per ~100 ms so fast runs send few or none.
 */

import { computeTrajectory } from '../engine/trajectory.js';
import { createRng } from '../engine/rng.js';
import { getStrategy } from '../strategies/index.js';
import { getSchedule } from '../schedules/index.js';
import { loadTokenizer } from '../tokenizers/index.js';
import {
	getStringDistanceKernel,
	stringDistanceKernelFor,
} from '../strategies/string-distance-kernel.js';
import type { CharOverlapMode } from '../strategies/char-overlap-model.js';
import type { DistanceModel } from '../strategies/distance-model.js';
import type { WeightFamilyId } from '../strategies/weight-family.js';
import { NeighborhoodProvider } from '../strategies/neighborhood.js';
import { verifyVocabSha } from '../embeddings/vocab-sha.js';
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
import { tokenLabel } from './token-label.js';
import {
	getEmbeddingSource,
	loadEmbedding,
	EmbeddingKnnIndex,
	EmbeddingDistanceModel,
	EMBEDDING_CACHE_TAG,
	idbRowCache,
} from '../embeddings/index.js';
import {
	classifyTokens,
	buildTokenPredicate,
	predicateSignature,
} from '../strategies/embedding-filter.js';
import type { EmbeddingKnnConfig } from '../strategies/embedding-knn.js';
import type { MetricId, PreprocessId, EmbeddingSourceId } from '../embeddings/index.js';

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

/** Warm-up BFS: hard cap on tokens precomputed beyond the inputs. */
const WARMUP_MAX_TOKENS = 2000;

/** Warm-up BFS: wall-clock cap (the preferred bound, keeping pre-walk time bounded). */
const WARMUP_TIME_BUDGET_MS = 15_000;

/**
 * Fixed radius ceiling for the edit-distance neighborhood provider.
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

/** Radius ceiling per string-distance kernel id. */
const R_MAX_BY_KERNEL: Record<string, number> = {
	'edit-distance': R_MAX,
	'char-overlap-set': R_MAX_CHAR,
	'char-overlap-multiset': R_MAX_CHAR,
};

/**
 * Nearest neighbors kept per token by all providers. Reads take at most
 * the top $k$ within `maxDistance`, and the UI caps $k$ at 200, so this
 * bound leaves every read unchanged while keeping per-token memory fixed.
 */
const NEIGHBOR_STORE_LIMIT = 200;

/**
 * Cached model/provider pair per string-distance kernel + tokenizer id.
 * The model decodes all $K$ strings once; the provider memoizes
 * per-token neighborhoods computed on first visit during the walk.
 */
const _providerCache = new Map<string, { model: DistanceModel; provider: NeighborhoodProvider }>();

/**
 * Cached embedding-backed model/provider/index triple per embedding
 * config. The matrix (int8, ~24 MB) and memoized top-$M$ rows are shared
 * across requests with the same
 * `sourceId:preprocess:metric:predicate-signature` key.
 */
const _embeddingCache = new Map<
	string,
	{
		model: DistanceModel;
		provider: NeighborhoodProvider;
		index: EmbeddingKnnIndex;
		predicate: (id: number) => boolean;
	}
>();

/**
 * Ensure the embedding-backed `DistanceModel` + `NeighborhoodProvider`
 * for an embedding-knn config are ready for a tokenizer.
 *
 * Validates that the embedding source's `tokenizerId` matches the active
 * tokenizer (embedding rows are indexed by the source model's own
 * vocabulary), loads + decodes the quantized matrix (IndexedDB-cached),
 * classifies the vocabulary once, and wraps the kNN index in the
 * standard `NeighborhoodProvider` with $R_{\max} = \infty$ (kNN
 * semantics: `maxDistance` filtering happens at read time in the
 * strategy, not at store time).
 *
 * The cache key pins everything that shapes the stored rows (`sourceId`,
 * preprocessing, metric, and the filter predicate signature), so a
 * parameter change rebuilds rather than mixes rows.
 */
async function ensureEmbeddingProvider(
	sourceId: EmbeddingSourceId,
	preprocess: PreprocessId,
	metric: MetricId,
	k: number,
	tokenizerId: string,
	cfg: Pick<
		EmbeddingKnnConfig,
		'tokenClass' | 'excludeSpecial' | 'excludeUnused' | 'excludeByteFallback'
	>,
	onProgress?: VocabProgress,
): Promise<{
	provider: NeighborhoodProvider;
	index: EmbeddingKnnIndex;
	predicate: (id: number) => boolean;
}> {
	const info = getEmbeddingSource(sourceId);
	if (info.tokenizerId !== tokenizerId) {
		throw new Error(
			`Embedding source "${sourceId}" requires the "${info.tokenizerId}" tokenizer, but "${tokenizerId}" is active.`,
		);
	}
	const cacheKey = `embedding:${sourceId}:${preprocess}:${metric}:${predicateSignature(cfg)}`;
	const cached = _embeddingCache.get(cacheKey);
	if (cached)
		return { provider: cached.provider, index: cached.index, predicate: cached.predicate };

	const { matrix, transform, meta } = await loadEmbedding(sourceId, onProgress);
	const tok = await loadTokenizer(tokenizerId);
	const strings = await decodeVocab(tok, onProgress);
	if (strings.length !== meta.vocabSize || matrix.vocabSize !== meta.vocabSize) {
		throw new Error(
			`Embedding vocab mismatch for "${sourceId}": matrix has ${matrix.vocabSize} rows, tokenizer has ${strings.length}.`,
		);
	}
	await verifyVocabSha(meta, strings);
	const classes = classifyTokens(strings, tokenizerId);
	const predicate = buildTokenPredicate(classes, cfg);
	// Store the top-$M$ (M = NEIGHBOR_STORE_LIMIT); read-time filtering
	// (token class, $k$, maxDistance) happens in the strategy/kernel.
	const rowPrefix = `${sourceId}|${preprocess}|${metric}|${NEIGHBOR_STORE_LIMIT}@${EMBEDDING_CACHE_TAG}`;
	const index = new EmbeddingKnnIndex(matrix, transform, preprocess, metric, NEIGHBOR_STORE_LIMIT, {
		cache: idbRowCache,
		cacheKeyPrefix: rowPrefix,
	});
	const model = new EmbeddingDistanceModel(index, predicate, sourceId, preprocess, metric);
	const provider = new NeighborhoodProvider(model, Infinity, {
		maxStored: NEIGHBOR_STORE_LIMIT,
	});
	_embeddingCache.set(cacheKey, { model, provider, index, predicate });
	return { provider, index, predicate };
}

/** Callback reporting decoded-token count and vocabulary size. */
type VocabProgress = (done: number, total: number) => void;

/**
 * Distinct token ids in `ids`, first-occurrence order. Used to bound the
 * embedding row precompute to the tokens the walk can actually visit.
 */
function distinctTokens(ids: Int32Array): Int32Array {
	const seen = new Set<number>();
	const out: number[] = [];
	for (let i = 0; i < ids.length; i++) {
		const v = ids[i]!;
		if (!seen.has(v)) {
			seen.add(v);
			out.push(v);
		}
	}
	return Int32Array.from(out);
}

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
 * Ensure the `DistanceModel` + `NeighborhoodProvider` for a string-distance
 * kernel are ready for a tokenizer. Decodes all $K$ token strings (one-time
 * cost per kernel+tokenizer lifetime), builds the model via the kernel's
 * `makeModel`, and wraps it in a provider.
 *
 * The cache key includes the kernel id, so set and multiset char-overlap
 * (and future kernels) don't collide. The radius ceiling comes from
 * `R_MAX_BY_KERNEL`.
 */
async function ensureDistanceSourceProvider(
	kernelId: string,
	tokenizerId: string,
	onProgress?: VocabProgress,
): Promise<NeighborhoodProvider> {
	const cacheKey = `${kernelId}:${tokenizerId}`;
	const cached = _providerCache.get(cacheKey);
	if (cached) return cached.provider;

	const tok = await loadTokenizer(tokenizerId);
	const strings = await decodeVocab(tok, onProgress);

	const model = getStringDistanceKernel(kernelId).makeModel(strings);
	// Own-property check: inherited keys like 'toString' must fall back to
	// the default radius instead of crashing with a TypeError.
	const rMax = Object.hasOwn(R_MAX_BY_KERNEL, kernelId) ? R_MAX_BY_KERNEL[kernelId]! : R_MAX;
	const provider = new NeighborhoodProvider(model, rMax, {
		maxStored: NEIGHBOR_STORE_LIMIT,
	});
	_providerCache.set(cacheKey, { model, provider });
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
		// For distance-based strategies: build (or reuse) the provider for
		// the strategy's string-distance kernel.
		let provider: NeighborhoodProvider | undefined;
		if (spec.strategyId === 'lexical') {
			provider = await ensureDistanceSourceProvider(
				'edit-distance',
				spec.tokenizerId,
				(done, total) => postProgress('preparing', done, total),
			);
		} else if (spec.strategyId === 'char-overlap') {
			const mode = (spec.strategyConfig as { mode?: CharOverlapMode }).mode ?? 'set';
			provider = await ensureDistanceSourceProvider(
				stringDistanceKernelFor(mode).id,
				spec.tokenizerId,
				(done, total) => postProgress('preparing', done, total),
			);
		} else if (spec.strategyId === 'embedding-knn') {
			const cfg = spec.strategyConfig as unknown as EmbeddingKnnConfig;
			const emb = await ensureEmbeddingProvider(
				cfg.sourceId,
				cfg.preprocess,
				cfg.metric,
				cfg.k,
				spec.tokenizerId,
				cfg,
				(done, total) => postProgress('preparing', done, total),
			);
			provider = emb.provider;
			// Materialize the contiguous row matrix once (memoized); later
			// requests with the same config skip this almost instantly.
			await emb.index.materialize((done, total) => postProgress('materializing', done, total));
			// Rows for the walk's input tokens are precomputed up front
			// (chunked, non-blocking) so the walk itself never stalls.
			const inputs = distinctTokens(spec.inputIds);
			await emb.index.precomputeRows(inputs, (done, total) =>
				postProgress('embeddings', done, total),
			);
			// Budgeted warm-up BFS: walk outward over the kNN graph from the
			// inputs, precomputing reachable rows so the walk hits the memo
			// or the IndexedDB cache instead of cold scans. Bounded by a
			// token cap and a wall-clock budget (the preferred bound): the
			// deadline is checked before each frontier expansion and passed
			// to `precomputeRows`, which also honours it between chunks, so
			// the budget holds even mid-batch.
			const warmStart = performance.now();
			const deadline = warmStart + WARMUP_TIME_BUDGET_MS;
			const seen = new Set<number>();
			for (let i = 0; i < inputs.length; i++) seen.add(inputs[i]!);
			let frontier = inputs;
			let warmed = 0;
			while (frontier.length > 0 && warmed < WARMUP_MAX_TOKENS && performance.now() < deadline) {
				const next: number[] = [];
				for (let i = 0; i < frontier.length; i++) {
					const neighbours = emb.index.topM(frontier[i]!).ids;
					for (let j = 0; j < neighbours.length; j++) {
						const id = neighbours[j]!;
						if (seen.has(id) || !emb.predicate(id)) continue;
						seen.add(id);
						next.push(id);
					}
				}
				if (next.length === 0) break;
				const batch = Int32Array.from(next.slice(0, WARMUP_MAX_TOKENS - warmed));
				warmed += batch.length;
				await emb.index.precomputeRows(
					batch,
					(done, total) => postProgress('embeddings', done, total),
					deadline,
				);
				frontier = batch;
			}
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
			provider = await ensureDistanceSourceProvider('edit-distance', tokenizerId);
			const cfg = strategyConfig as {
				maxDistance?: number;
				k?: number;
				tau?: number;
				family?: WeightFamilyId;
			};
			graphParams = {
				maxDistance: cfg.maxDistance ?? 2,
				k: cfg.k ?? 50,
				tau: cfg.tau ?? 1.0,
				family: cfg.family ?? 'exponential',
			};
		} else if (strategyId === 'char-overlap') {
			const mode = (strategyConfig as { mode?: 'set' | 'multiset' }).mode ?? 'set';
			provider = await ensureDistanceSourceProvider(stringDistanceKernelFor(mode).id, tokenizerId);
			const cfg = strategyConfig as {
				maxDistance?: number;
				k?: number;
				tau?: number;
				family?: WeightFamilyId;
			};
			graphParams = {
				maxDistance: cfg.maxDistance ?? 0.5,
				k: cfg.k ?? 50,
				tau: cfg.tau ?? 1.0,
				family: cfg.family ?? 'exponential',
			};
		} else if (strategyId === 'embedding-knn') {
			const cfg = strategyConfig as unknown as EmbeddingKnnConfig;
			provider = (
				await ensureEmbeddingProvider(
					cfg.sourceId,
					cfg.preprocess,
					cfg.metric,
					cfg.k,
					tokenizerId,
					cfg,
				)
			).provider;
			graphParams = {
				maxDistance: cfg.maxDistance ?? Infinity,
				k: cfg.k ?? 50,
				tau: cfg.tau ?? 1.0,
				family: cfg.family ?? 'exponential',
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
			(id) => tokenLabel(tok, id, vocabSize, msg.oovTokens),
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
			provider = await ensureDistanceSourceProvider('edit-distance', tokenizerId);
			const cfg = strategyConfig as {
				maxDistance?: number;
				k?: number;
				tau?: number;
				family?: WeightFamilyId;
			};
			graphParams = {
				maxDistance: cfg.maxDistance ?? 2,
				k: cfg.k ?? 50,
				tau: cfg.tau ?? 1.0,
				family: cfg.family ?? 'exponential',
			};
		} else if (strategyId === 'char-overlap') {
			const mode = (strategyConfig as { mode?: CharOverlapMode }).mode ?? 'set';
			provider = await ensureDistanceSourceProvider(stringDistanceKernelFor(mode).id, tokenizerId);
			const cfg = strategyConfig as {
				maxDistance?: number;
				k?: number;
				tau?: number;
				family?: WeightFamilyId;
			};
			graphParams = {
				maxDistance: cfg.maxDistance ?? 0.5,
				k: cfg.k ?? 50,
				tau: cfg.tau ?? 1.0,
				family: cfg.family ?? 'exponential',
			};
		} else if (strategyId === 'embedding-knn') {
			const cfg = strategyConfig as unknown as EmbeddingKnnConfig;
			provider = (
				await ensureEmbeddingProvider(
					cfg.sourceId,
					cfg.preprocess,
					cfg.metric,
					cfg.k,
					tokenizerId,
					cfg,
				)
			).provider;
			graphParams = {
				maxDistance: cfg.maxDistance ?? Infinity,
				k: cfg.k ?? 50,
				tau: cfg.tau ?? 1.0,
				family: cfg.family ?? 'exponential',
			};
		}
		if (isStale()) return;

		const tok = await loadTokenizer(tokenizerId);
		if (isStale()) return;
		const labelOf = (id: number): string => tokenLabel(tok, id, vocabSize, msg.oovTokens);

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
			connectivity: built.connectivity,
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
