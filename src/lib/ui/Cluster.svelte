<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	type Props = Omit<HTMLAttributes<HTMLDivElement>, 'class' | 'children'> & {
		gap?: 1 | 2 | 3 | 4 | 6 | 8;
		align?: 'start' | 'center' | 'end' | 'baseline';
		justify?: 'start' | 'center' | 'end' | 'between';
		class?: string;
		children?: Snippet;
	};

	const ALIGN = { start: 'flex-start', center: 'center', end: 'flex-end', baseline: 'baseline' };
	const JUSTIFY = {
		start: 'flex-start',
		center: 'center',
		end: 'flex-end',
		between: 'space-between'
	};

	let {
		gap = 2,
		align = 'center',
		justify = 'start',
		class: className,
		children,
		...rest
	}: Props = $props();
</script>

<div
	class={['cluster', className]}
	style:gap="var(--space-{gap})"
	style:align-items={ALIGN[align]}
	style:justify-content={JUSTIFY[justify]}
	{...rest}
>
	{@render children?.()}
</div>

<style>
	.cluster {
		display: flex;
		flex-wrap: wrap;
	}
</style>
