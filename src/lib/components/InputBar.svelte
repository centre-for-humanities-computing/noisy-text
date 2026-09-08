<script lang="ts">
	interface Props {
		text: string;
		onedit: () => void;
	}

	let { text, onedit }: Props = $props();

	const summary = $derived(text.length > 60 ? text.slice(0, 60) + '\u2026' : text);
</script>

<div class="input-bar">
	<span class="summary">{summary}</span>
	<button class="edit-btn" onclick={onedit}>Edit</button>
</div>

<style>
	.input-bar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		border: 1px solid #ddd;
		border-radius: 6px;
		background: #fafafa;
		margin-bottom: 1.5rem;
	}
	.summary {
		flex: 1;
		font-family: monospace;
		font-size: 0.9rem;
		color: #555;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.edit-btn {
		flex-shrink: 0;
		font-size: 0.85rem;
		padding: 0.25rem 0.75rem;
		border: 1px solid #ccc;
		border-radius: 4px;
		background: #fff;
		cursor: pointer;
	}
	.edit-btn:hover {
		background: #eee;
	}
</style>
