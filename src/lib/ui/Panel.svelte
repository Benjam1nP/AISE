<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	type Props = Omit<HTMLAttributes<HTMLElement>, 'class' | 'children' | 'title'> & {
		title: string;
		actions?: Snippet;
		class?: string;
		children: Snippet;
	};

	let { title, actions, class: className, children, ...rest }: Props = $props();
</script>

<section class={['panel', className]} {...rest}>
	<header class="head">
		<h2>{title}</h2>
		{#if actions}<div class="actions">{@render actions()}</div>{/if}
	</header>
	<div class="body">{@render children()}</div>
</section>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		min-height: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
		overflow: hidden;
	}

	.head {
		display: flex;
		flex: none;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		min-height: calc(var(--space-12) + var(--space-2));
		padding: var(--space-2) var(--space-4);
		border-bottom: 1px solid var(--color-border);
	}

	.head h2 {
		font-family: var(--font-sans);
		font-size: var(--text-base);
		font-stretch: normal;
		font-weight: var(--weight-semibold);
		letter-spacing: 0;
	}

	.actions {
		display: flex;
		flex: none;
		gap: var(--space-2);
	}

	.body {
		flex: 1;
		min-height: 0;
		padding: var(--space-4);
		overflow: auto;
	}

	/* A scrollable body is focusable; the panel clips an outside ring. */
	.body:focus-visible {
		outline-offset: -2px;
	}
</style>
