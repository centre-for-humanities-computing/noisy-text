<script lang="ts">
	interface Props {
		text: string;
	}

	let { text }: Props = $props();
</script>

<p class="inline-text">{text}</p>

<style>
	.inline-text {
		font-family: system-ui, sans-serif;
		font-size: 1rem;
		line-height: 1.7;
		white-space: pre-wrap;
		word-break: break-word;
		margin: 0;
	}
</style>
