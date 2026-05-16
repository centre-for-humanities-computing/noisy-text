<script lang="ts">
  import { onMount } from 'svelte';
  import TokenChips from '$lib/components/TokenChips.svelte';
  import TokenizerPicker from '$lib/components/TokenizerPicker.svelte';
  import { tokenizerStore } from '$lib/stores/tokenizer.svelte.js';
  import { TOKENIZERS } from '$lib/tokenizers/index.js';

  let text = $state('Hello, world!');

  const tokenizerOptions = $derived(Object.values(TOKENIZERS));

  const encoded = $derived.by(() => {
    const t = tokenizerStore.tokenizer;
    if (!t || text.length === 0) return { ids: new Int32Array(0), tokens: [] as readonly string[] };
    const ids = t.encode(text);
    const tokens = t.idsToTokens(ids);
    return { ids, tokens };
  });

  const statusText = $derived.by(() => {
    const s = tokenizerStore.status;
    if (s === 'loading') return 'Loading tokenizer…';
    if (s === 'error') return `Error: ${tokenizerStore.error ?? 'unknown'}`;
    if (s === 'ready' && tokenizerStore.tokenizer) {
      const t = tokenizerStore.tokenizer;
      return `${t.info.label} · Vocab: ${t.vocabSize.toLocaleString()} · Tokens: ${encoded.ids.length}`;
    }
    return 'Select a tokenizer';
  });

  onMount(() => {
    tokenizerStore.selectTokenizer('gpt2');
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
  </div>

  <div class="status" class:error={tokenizerStore.status === 'error'}>
    {statusText}
  </div>

  <textarea
    bind:value={text}
    placeholder="Type or paste text here…"
    rows={6}
  ></textarea>

  {#if encoded.tokens.length > 0}
    <TokenChips tokens={encoded.tokens} ids={encoded.ids} />
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
  }
  .status.error {
    color: #c00;
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
</style>
