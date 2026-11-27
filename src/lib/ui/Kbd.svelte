<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	type Props = Omit<HTMLAttributes<HTMLElement>, 'class' | 'children'> & {
		class?: string;
		children?: Snippet;
	};

	let { class: className, children, ...rest }: Props = $props();
</script>

<kbd class={['kbd', className]} {...rest}>{@render children?.()}</kbd>

<style>
	.kbd {
		display: inline-block;
		padding: 0 var(--space-1);
		border: 1px solid var(--color-border-strong);
		border-bottom-width: 2px;
		border-radius: var(--radius-sm);
		background: var(--color-surface-2);
		color: var(--color-text);
		font-size: var(--text-xs);
		line-height: var(--leading-body);
	}
</style>
