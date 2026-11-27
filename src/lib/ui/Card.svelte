<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	type Props = Omit<HTMLAttributes<HTMLElement>, 'class' | 'children' | 'title'> & {
		title?: string;
		description?: string;
		actions?: Snippet;
		class?: string;
		children?: Snippet;
	};

	let { title, description, actions, class: className, children, ...rest }: Props = $props();
</script>

<section class={['card', className]} {...rest}>
	{#if title || description || actions}
		<header class="head">
			<div class="text">
				{#if title}<h3>{title}</h3>{/if}
				{#if description}<p class="description">{description}</p>{/if}
			</div>
			{#if actions}<div class="actions">{@render actions()}</div>{/if}
		</header>
	{/if}
	{#if children}<div class="body">{@render children()}</div>{/if}
</section>

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-6);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
	}

	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: var(--space-4);
	}

	.description {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}

	.actions {
		display: flex;
		flex: none;
		gap: var(--space-2);
	}
</style>
