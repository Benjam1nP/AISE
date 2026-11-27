<script lang="ts">
	import type { Snippet } from 'svelte';

	let { label, children }: { label: string; children: Snippet } = $props();
</script>

<figure class="specimen">
	{@render children()}
	<figcaption>{label}</figcaption>
</figure>

<style>
	.specimen {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		margin: 0;
		min-width: 0;
	}

	figcaption {
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}
</style>
