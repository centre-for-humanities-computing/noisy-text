import { describe, it, expect, vi } from 'vitest';
import { graphStore } from './graph.svelte.js';
import { trajectoryStore } from './trajectory.svelte.js';
import type { UnionGraph } from '$lib/workers/trajectory.protocol.js';

// The store checks the SvelteKit `browser` flag and talks to the worker
// through the trajectory store. Replace the latter with a fake that records
// posted union-graph requests and delivers worker responses by request id.
vi.mock('$app/environment', () => ({ browser: true }));
vi.mock('./trajectory.svelte.js', () => {
	type Handler = (msg: unknown) => void;
	const handlers = new Set<Handler>();
	const posted: { requestId: number }[] = [];
	return {
		trajectoryStore: {
			posted,
			onUnionMessage(h: Handler) {
				handlers.add(h);
				return () => handlers.delete(h);
			},
			postUnionGraph(msg: { requestId: number }) {
				posted.push(msg);
			},
			deliver(msg: unknown) {
				for (const h of handlers) h(msg);
			},
		},
	};
});

interface FakeTrajectoryStore {
	posted: { requestId: number }[];
	deliver(msg: unknown): void;
}
const fake = trajectoryStore as unknown as FakeTrajectoryStore;

/** A request with a unique cache key (the store is a shared singleton). */
function request(key: string) {
	return {
		key,
		tokenizerId: 'tok',
		strategyId: 'uniform',
		strategyConfig: {},
		vocabSize: 10,
		rows: new Int32Array(2),
		T: 1,
		L: 2,
		limitMode: 'top-k' as const,
		k: 5,
		p: 0.95,
	};
}

/** Request id of the most recently posted build. */
const latestId = (): number => fake.posted.at(-1)!.requestId;

/** A stand-in graph, identifiable by its tag. */
const graph = (tag: string): UnionGraph => ({ tag }) as unknown as UnionGraph;

describe('graphStore', () => {
	it('posts a cache miss and applies its result', () => {
		graphStore.request(request('miss-1'));
		expect(graphStore.status).toBe('computing');
		const g = graph('miss-1');
		fake.deliver({ kind: 'union-graph', requestId: latestId(), graph: g });
		expect(graphStore.status).toBe('ready');
		expect(graphStore.graph).toBe(g);
	});

	it('drops results from a superseded build', () => {
		graphStore.request(request('sup-1'));
		const stale = latestId();
		graphStore.request(request('sup-2'));
		const fresh = latestId();
		expect(fresh).toBeGreaterThan(stale);

		const shownBefore = graphStore.graph;
		const staleGraph = graph('sup-1');
		fake.deliver({ kind: 'union-graph', requestId: stale, graph: staleGraph });
		expect(graphStore.status).toBe('computing');
		expect(graphStore.graph).toBe(shownBefore);
		expect(graphStore.graph).not.toBe(staleGraph);

		const g2 = graph('sup-2');
		fake.deliver({ kind: 'union-graph', requestId: fresh, graph: g2 });
		expect(graphStore.graph).toBe(g2);
	});

	it('a cache hit shows the cached graph, and a finished build for another key is cached but not shown', () => {
		graphStore.request(request('hit-a'));
		const ga = graph('hit-a');
		fake.deliver({ kind: 'union-graph', requestId: latestId(), graph: ga });
		expect(graphStore.graph).toBe(ga);

		graphStore.request(request('hit-b'));
		const posts = fake.posted.length;
		const gb = graph('hit-b');

		// Back to a cached key while 'hit-b' is still building.
		graphStore.request(request('hit-a'));
		expect(fake.posted.length).toBe(posts);
		expect(graphStore.status).toBe('ready');
		expect(graphStore.graph).toBe(ga);

		// The finished build is cached but does not replace what the UI shows.
		fake.deliver({ kind: 'union-graph', requestId: latestId(), graph: gb });
		expect(graphStore.status).toBe('ready');
		expect(graphStore.graph).toBe(ga);

		graphStore.request(request('hit-b'));
		expect(graphStore.graph).toBe(gb);
	});

	it('re-requesting the build that is already running does not post again', () => {
		graphStore.request(request('dup-1'));
		const posts = fake.posted.length;
		graphStore.request(request('dup-1'));
		expect(fake.posted.length).toBe(posts);
		expect(graphStore.status).toBe('computing');

		const g = graph('dup-1');
		fake.deliver({ kind: 'union-graph', requestId: latestId(), graph: g });
		expect(graphStore.graph).toBe(g);
	});

	it('reports the error of the build the UI wants', () => {
		graphStore.request(request('err-1'));
		fake.deliver({ kind: 'union-graph-error', requestId: latestId(), message: 'boom' });
		expect(graphStore.status).toBe('error');
		expect(graphStore.error).toBe('boom');
	});

	it('applies progress only from the build the UI wants', () => {
		graphStore.request(request('prog-1'));
		const first = latestId();
		graphStore.request(request('prog-2'));
		const second = latestId();

		fake.deliver({
			kind: 'union-graph-progress',
			requestId: first,
			phase: 'neighbors',
			step: 1,
			total: 2,
		});
		expect(graphStore.progress).toBe(0);

		fake.deliver({
			kind: 'union-graph-progress',
			requestId: second,
			phase: 'layout',
			step: 1,
			total: 4,
		});
		expect(graphStore.progress).toBe(0.25);
		expect(graphStore.phase).toBe('layout');
	});
});
