<script lang="ts">
	import { parseBlocks, type Inline, type ListBlock } from '#lib/chat-markdown.ts';

	let { text }: { text: string } = $props();

	const blocks = $derived(parseBlocks(text));
</script>

{#snippet inline(parts: Inline[])}
	{#each parts as part, i (i)}
		{#if part.kind === 'strong'}<strong>{part.text}</strong>
		{:else if part.kind === 'em'}<em>{part.text}</em>
		{:else if part.kind === 'code'}<code>{part.text}</code>
		{:else}{part.text}{/if}
	{/each}
{/snippet}

{#snippet list(block: ListBlock)}
	{#if block.ordered}
		<ol start={block.start}>{@render items(block)}</ol>
	{:else}
		<ul>{@render items(block)}</ul>
	{/if}
{/snippet}

{#snippet items(block: ListBlock)}
	{#each block.items as item, j (j)}
		<li>
			{@render inline(item.inline)}
			{#if item.sub}{@render list(item.sub)}{/if}
		</li>
	{/each}
{/snippet}

<div class="md">
	{#each blocks as block, i (i)}
		{#if block.kind === 'heading'}
			<svelte:element this={`h${block.level + 3}`} class={['heading', `h${block.level}`]}>
				{@render inline(block.inline)}
			</svelte:element>
		{:else if block.kind === 'paragraph'}
			<p>{@render inline(block.inline)}</p>
		{:else if block.kind === 'quote'}
			<blockquote>{@render inline(block.inline)}</blockquote>
		{:else if block.kind === 'code'}
			<pre><code>{block.text}</code></pre>
		{:else if block.kind === 'rule'}
			<hr />
		{:else}
			{@render list(block)}
		{/if}
	{/each}
</div>

<style>
	.md {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		overflow-wrap: anywhere;
	}

	p,
	blockquote {
		white-space: pre-wrap;
	}

	.heading {
		margin: 0;
		font-size: var(--text-base);
		font-weight: var(--text-lg-weight);
		text-decoration: underline;
		text-decoration-color: var(--color-border-strong);
		text-underline-offset: 0.25em;
	}

	.h1,
	.h2 {
		font-size: var(--text-lg);
	}

	.h2 {
		font-weight: 600;
	}

	hr {
		border: 0;
		border-top: 1px solid var(--color-border-strong);
	}

	li > :global(ul),
	li > :global(ol) {
		margin-top: var(--space-1);
	}

	.heading:not(:first-child) {
		margin-top: var(--space-1);
	}

	strong {
		font-weight: 600;
	}

	ul,
	ol {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding-left: var(--space-6);
	}

	ul {
		list-style: disc;
	}

	ol {
		list-style: decimal;
	}

	li::marker {
		color: var(--color-text-muted);
	}

	code {
		padding: 0 var(--space-1);
		border-radius: var(--radius-sm);
		background: var(--color-surface-2);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
	}

	pre {
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		background: var(--color-surface-2);
		overflow-x: auto;
	}

	pre code {
		padding: 0;
		background: none;
	}

	blockquote {
		padding-left: var(--space-3);
		border-left: 2px solid var(--color-border-strong);
		color: var(--color-text-soft);
	}

	:global(.discarded) blockquote {
		color: inherit;
	}
</style>
