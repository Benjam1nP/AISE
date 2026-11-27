<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { createDelay } from './delay.svelte.ts';

	type Props = Omit<HTMLAttributes<HTMLDivElement>, 'class'> & {
		/** Any CSS length, for example `100%` or `var(--space-16)`. */
		width?: string;
		height?: string;
		/** Renders this many text lines; the last one is shorter. */
		lines?: number;
		/** Milliseconds to wait before showing anything. Waits shorter than this render nothing (use 300 for fetches). */
		delay?: number;
		class?: string;
	};

	let {
		width = '100%',
		height = 'var(--space-4)',
		lines,
		delay = 0,
		class: className,
		...rest
	}: Props = $props();

	const wait = createDelay(() => delay);
</script>

{#if wait.ready}
	<div class={['skeleton', className]} aria-hidden="true" {...rest}>
		{#if lines}
			{#each [...Array(lines).keys()] as i (i)}
				<span class="bar" style:height style:width={i === lines - 1 && lines > 1 ? '60%' : width}
				></span>
			{/each}
		{:else}
			<span class="bar" style:height style:width></span>
		{/if}
	</div>
{/if}

<style>
	.skeleton {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.bar {
		display: block;
		max-width: 100%;
		border-radius: var(--radius-sm);
		background: var(--color-surface-2);
		animation: aise-pulse calc(var(--duration-500) * 3) var(--ease-in-out) infinite;
	}
</style>
