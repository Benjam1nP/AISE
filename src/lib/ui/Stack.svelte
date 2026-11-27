<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	type Props = Omit<HTMLAttributes<HTMLDivElement>, 'class' | 'children'> & {
		/** Space between children, in `--space-N` steps. */
		gap?: 1 | 2 | 3 | 4 | 6 | 8;
		class?: string;
		children?: Snippet;
	};

	let { gap = 4, class: className, children, ...rest }: Props = $props();
</script>

<div class={['stack', className]} style:gap="var(--space-{gap})" {...rest}>
	{@render children?.()}
</div>

<style>
	.stack {
		display: flex;
		flex-direction: column;
	}
</style>
