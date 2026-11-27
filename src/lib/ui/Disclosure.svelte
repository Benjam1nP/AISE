<script lang="ts">
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import type { Snippet } from 'svelte';
	import type { HTMLDetailsAttributes } from 'svelte/elements';
	import Icon from './Icon.svelte';

	type Props = Omit<HTMLDetailsAttributes, 'class' | 'children' | 'open'> & {
		summary: string;
		open?: boolean;
		/** No frame: for a disclosure inside a table row or list. */
		bare?: boolean;
		class?: string;
		children?: Snippet;
	};

	let {
		summary,
		open = $bindable(false),
		bare = false,
		class: className,
		children,
		...rest
	}: Props = $props();
</script>

<details class={['disclosure', bare && 'bare', className]} bind:open {...rest}>
	<summary class="summary">
		<Icon icon={ChevronRight} size={16} class="chevron" />
		{summary}
	</summary>
	<div class="content">{@render children?.()}</div>
</details>

<style>
	.disclosure {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
	}

	.summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--hit-area);
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-md);
		font-weight: var(--weight-medium);
		cursor: pointer;
		list-style: none;
		transition: background-color var(--duration-100) var(--ease-out);
	}

	.summary::-webkit-details-marker {
		display: none;
	}

	.summary:hover {
		background: var(--color-surface-2);
	}

	.summary:active {
		background: var(--color-border);
	}

	.summary :global(.chevron) {
		color: var(--color-text-muted);
		transition: transform var(--duration-200) var(--ease-in-out);
	}

	.disclosure[open] .summary :global(.chevron) {
		transform: rotate(90deg);
	}

	.content {
		padding: var(--space-2) var(--space-4) var(--space-4);
	}

	.bare {
		border: 0;
		background: transparent;
	}

	.bare .summary {
		min-height: var(--space-6);
		margin: calc(0px - var(--space-1)) calc(0px - var(--space-2));
		padding: var(--space-1) var(--space-2);
	}

	.bare .content {
		padding: var(--space-2) 0 0 var(--space-6);
	}
</style>
