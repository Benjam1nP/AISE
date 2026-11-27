<script lang="ts">
	import type { PhaseStatus } from '#lib/server/core/state.ts';
	import type { HTMLAttributes } from 'svelte/elements';
	import Badge from './Badge.svelte';

	type Props = Omit<HTMLAttributes<HTMLSpanElement>, 'class'> & {
		status: PhaseStatus;
		class?: string;
	};

	const VIEW = {
		not_started: { label: 'Not started', tone: 'default' },
		running: { label: 'Running', tone: 'new' },
		awaiting_approval: { label: 'Awaiting approval', tone: 'new' },
		approved: { label: 'Approved', tone: 'active' },
		stale: { label: 'Stale', tone: 'pending' }
	} as const;

	let { status, class: className, ...rest }: Props = $props();

	const view = $derived(VIEW[status]);
</script>

<Badge tone={view.tone} class={className} {...rest}>
	<span
		class={['dot', status === 'running' && 'pulse', status === 'awaiting_approval' && 'ring']}
		aria-hidden="true"
	></span>
	{view.label}
</Badge>

<style>
	.dot {
		width: var(--space-2);
		height: var(--space-2);
		border-radius: var(--radius-full);
		background: currentColor;
	}

	/* Awaiting approval shares the brand tone with running; a hollow dot keeps them apart without motion. */
	.ring {
		border: 1.5px solid currentColor;
		background: transparent;
	}

	.pulse {
		animation: aise-pulse var(--duration-500) var(--ease-in-out) infinite;
	}
</style>
