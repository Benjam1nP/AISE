<script lang="ts" module>
	export type TableColumn = { key: string; label: string; width?: string };
	export type TableRow = Record<string, unknown>;
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	type Props = Omit<HTMLAttributes<HTMLDivElement>, 'class'> & {
		columns: TableColumn[];
		rows: TableRow[];
		/** Shown instead of rows when there are none. */
		empty?: Snippet;
		/** Custom cell content; the default prints `row[column.key]`. */
		cell?: Snippet<[{ row: TableRow; column: TableColumn }]>;
		class?: string;
	};

	let { columns, rows, empty, cell, class: className, ...rest }: Props = $props();
</script>

<div class={['scroll', className]} {...rest}>
	<table class="table">
		<thead>
			<tr>
				{#each columns as column (column.key)}
					<th scope="col" style:width={column.width}>{column.label}</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each rows as row, i (i)}
				<tr>
					{#each columns as column (column.key)}
						<td>
							{#if cell}{@render cell({ row, column })}{:else}{row[column.key] ?? ''}{/if}
						</td>
					{/each}
				</tr>
			{:else}
				<tr>
					<td class="empty" colspan={columns.length}>
						{#if empty}{@render empty()}{:else}No rows{/if}
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.scroll {
		overflow-x: auto;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
	}

	.table {
		width: 100%;
		border-collapse: collapse;
		font-size: var(--text-sm);
	}

	th,
	td {
		padding: var(--space-3) var(--space-4);
		border-bottom: 1px solid var(--color-border);
		text-align: left;
		vertical-align: top;
	}

	th {
		padding-block: var(--space-2);
		background: color-mix(in srgb, var(--color-surface-2) 60%, var(--color-surface));
		color: var(--color-text-muted);
		font-size: var(--text-xs);
		font-weight: var(--weight-medium);
		white-space: nowrap;
	}

	tbody tr {
		transition: background-color var(--duration-100) var(--ease-out);
	}

	tbody tr:hover {
		background: color-mix(in srgb, var(--color-surface-2) 50%, transparent);
	}

	tbody tr:last-child td {
		border-bottom: 0;
	}

	.empty {
		padding: var(--space-8) var(--space-4);
		color: var(--color-text-muted);
		text-align: center;
	}
</style>
