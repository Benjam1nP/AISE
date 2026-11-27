<script lang="ts">
	import type { LucideIcon } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import Icon from './Icon.svelte';

	type Props = Omit<HTMLAttributes<HTMLDivElement>, 'class' | 'title'> & {
		icon: LucideIcon;
		title: string;
		text: string;
		action?: Snippet;
		class?: string;
	};

	let { icon, title, text, action, class: className, ...rest }: Props = $props();
</script>

<div class={['empty', className]} {...rest}>
	<Icon {icon} size={48} class="glyph" />
	<h3>{title}</h3>
	<p class="text">{text}</p>
	{#if action}<div class="action">{@render action()}</div>{/if}
</div>

<style>
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-8) var(--space-4);
		text-align: center;
	}

	.empty :global(.glyph) {
		color: var(--color-text-soft);
	}

	.text {
		max-width: 40ch;
		color: var(--color-text-muted);
	}

	.action {
		margin-top: var(--space-2);
	}
</style>
