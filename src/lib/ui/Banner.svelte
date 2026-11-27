<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Info from '@lucide/svelte/icons/info';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import Icon from './Icon.svelte';

	type Props = Omit<HTMLAttributes<HTMLDivElement>, 'class' | 'children' | 'title'> & {
		tone?: 'info' | 'success' | 'warning' | 'error';
		title: string;
		actions?: Snippet;
		class?: string;
		children?: Snippet;
	};

	const ICONS = { info: Info, success: CircleCheck, warning: TriangleAlert, error: CircleAlert };

	let { tone = 'info', title, actions, class: className, children, ...rest }: Props = $props();
</script>

<div
	class={['banner', className]}
	data-tone={tone}
	role={tone === 'error' ? 'alert' : 'status'}
	{...rest}
>
	<Icon icon={ICONS[tone]} class="glyph" />
	<div class="text">
		<p class="title">{title}</p>
		{#if children}<div class="detail">{@render children()}</div>{/if}
	</div>
	{#if actions}<div class="actions">{@render actions()}</div>{/if}
</div>

<style>
	.banner {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--tone);
		border-radius: var(--radius-md);
		background: var(--tone-tint);
		color: var(--color-text);
	}

	[data-tone='info'] {
		--tone: var(--color-info);
		--tone-tint: var(--color-info-tint);
	}

	[data-tone='success'] {
		--tone: var(--color-success);
		--tone-tint: var(--color-success-tint);
	}

	[data-tone='warning'] {
		--tone: var(--color-warning);
		--tone-tint: var(--color-warning-tint);
	}

	[data-tone='error'] {
		--tone: var(--color-error);
		--tone-tint: var(--color-error-tint);
	}

	.banner :global(.glyph) {
		margin-top: var(--space-1);
		color: var(--tone);
	}

	.text {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}

	.title {
		color: var(--tone);
		font-weight: var(--weight-semibold);
	}

	.detail {
		font-size: var(--text-sm);
	}

	.actions {
		display: flex;
		flex: none;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
</style>
