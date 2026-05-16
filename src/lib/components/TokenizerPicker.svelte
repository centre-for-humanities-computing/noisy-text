<script lang="ts">
  import type { TokenizerInfo } from '$lib/tokenizers/types.js';

  interface Props {
    value: string;
    options: readonly TokenizerInfo[];
    disabled: boolean;
    onchange: (id: string) => void;
  }

  let { value, options, disabled }: Props = $props();

  function onChange(e: Event): void {
    const select = e.target as HTMLSelectElement;
    dispatch(select.value);
  }

  function dispatch(id: string): void {
    const event = new CustomEvent('change', { detail: id });
    // Svelte 5: use the element itself to dispatch
  }
</script>

<select {disabled} value={value} onchange={onChange}>
  {#each options as opt}
    <option value={opt.id} title={opt.description}>{opt.label}</option>
  {/each}
</select>
