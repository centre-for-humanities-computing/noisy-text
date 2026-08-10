<script lang="ts">
	interface Props {
		tokens: readonly string[];
		ids: Int32Array;
		changed: Uint8Array;
	}

	let { tokens, ids, changed }: Props = $props();

	/**
	 * Make whitespace and control characters visible in chip labels.
	 * BPE uses `Ġ` (U+0120) for leading space; WordPiece uses `##` prefix.
	 * We also replace literal space/newline/tab with visible glyphs.
	 */
	function visibleToken(t: string): string {
		return t.replace(/ /g, '␣').replace(/\n/g, '↵').replace(/\t/g, '→');
	}
</script>

<div class="chips">
	{#each tokens as token, i (i)}
		<span class="chip" class:changed={changed[i] === 1} title="id: {ids[i] ?? '?'}">
			<span class="chip-token">{visibleToken(token)}</span>
			<span class="chip-id">{ids[i] ?? '?'}</span>
		</span>
	{/each}
</div>

<style>
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		font-family: monospace;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		background: #e8e8e8;
		border-radius: 4px;
		padding: 2px 6px;
		font-size: 0.85rem;
	}
	.chip.changed {
		background: #fff3cd;
		border-bottom: 2px solid #b8860b;
	}
	.chip-token {
		color: #222;
	}
	.chip-id {
		color: #888;
		font-size: 0.7rem;
	}
</style>
