<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Stack, Table } from '#lib/ui/index.ts';
	import CodeBlock from './CodeBlock.svelte';
	import type { ComponentDoc } from './docs';

	let { doc, children }: { doc: ComponentDoc; children: Snippet } = $props();

	const columns = [
		{ key: 'name', label: 'Prop' },
		{ key: 'type', label: 'Type' },
		{ key: 'default', label: 'Default' },
		{ key: 'description', label: 'Description' }
	];
</script>

<section class="doc" id={doc.name}>
	<Stack gap={4}>
		<div>
			<h2>{doc.name}</h2>
			<p class="summary">{doc.summary}</p>
		</div>
		<dl class="when">
			<dt>Use when</dt>
			<dd>{doc.use}</dd>
			<dt>Avoid when</dt>
			<dd>{doc.avoid}</dd>
		</dl>
		<div class="demo">{@render children()}</div>
		{#if doc.props.length}
			<Table {columns} rows={doc.props}>
				{#snippet cell({ row, column })}
					{#if column.key === 'name' || column.key === 'type' || column.key === 'default'}
						<code>{row[column.key] ?? ''}</code>
					{:else}
						{row[column.key] ?? ''}
					{/if}
				{/snippet}
			</Table>
		{/if}
		<CodeBlock code={doc.code} />
	</Stack>
</section>

<style>
	.doc {
		scroll-margin-top: var(--space-4);
		padding-block: var(--space-8);
		border-top: 1px solid var(--color-border);
	}

	.summary {
		color: var(--color-text-muted);
	}

	.when {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: var(--space-1) var(--space-4);
		margin: 0;
		font-size: var(--text-sm);
	}

	dt {
		color: var(--color-text-muted);
		font-weight: var(--weight-semibold);
	}

	dd {
		margin: 0;
	}

	.demo {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		padding: var(--space-6);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-bg);
	}
</style>
