<script lang="ts">
	import LoaderCircle from '@lucide/svelte/icons/loader-circle';
	import type { HTMLAttributes } from 'svelte/elements';
	import { createDelay } from './delay.svelte.ts';
	import Icon from './Icon.svelte';

	type Props = Omit<HTMLAttributes<HTMLSpanElement>, 'class'> & {
		size?: 16 | 20 | 24 | 32;
		/** Accessible name. An empty label makes the spinner decorative (use it inside a labelled control). */
		label?: string;
		/** Milliseconds to wait before showing anything. Waits shorter than this render nothing (use 300 for fetches). */
		delay?: number;
		class?: string;
	};

	let { size = 20, label = 'Loading', delay = 0, class: className, ...rest }: Props = $props();

	const wait = createDelay(() => delay);
</script>

{#if wait.ready}
	<span
		class={['spinner', className]}
		role={label ? 'status' : undefined}
		aria-label={label || undefined}
		aria-hidden={label ? undefined : 'true'}
		{...rest}
	>
		<Icon icon={LoaderCircle} {size} />
	</span>
{/if}

<style>
	.spinner {
		display: inline-flex;
		color: var(--spinner-color, var(--color-brand));
		animation: spin calc(var(--duration-500) * 2) linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
