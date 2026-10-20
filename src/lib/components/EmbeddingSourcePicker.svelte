<script lang="ts">
	import CardPicker from './CardPicker.svelte';
	import { EMBEDDING_SOURCES } from '$lib/embeddings/index.js';
	import type { EmbeddingSourceId } from '$lib/embeddings/index.js';

	interface Props {
		/** Currently selected embedding source id. */
		value: EmbeddingSourceId;
		/** Whether the picker is disabled. */
		disabled: boolean;
		/** Called when the user selects a source. */
		onchange: (id: EmbeddingSourceId) => void;
	}

	let { value, disabled, onchange }: Props = $props();

	// `EmbeddingSourceInfo` carries id/label/plainName/gloss/tooltip, which
	// is exactly the `CardOption` shape CardPicker renders.
	const options = Object.values(EMBEDDING_SOURCES);
</script>

<CardPicker
	{value}
	{options}
	{disabled}
	variant="quiet"
	ariaLabel="Embedding source"
	onchange={(id) => onchange(id as EmbeddingSourceId)}
/>
