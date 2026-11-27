<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	type Tone = 'new' | 'active' | 'pending' | 'error' | 'info' | 'default';

	type Props = Omit<HTMLAttributes<HTMLSpanElement>, 'class' | 'children'> & {
		tone?: Tone;
		class?: string;
		children?: Snippet;
	};

	/** The colour each tone uses. StatusBadge and tests read it from `data-tone`. */
	const COLOUR: Record<Tone, string> = {
		new: 'brand',
		active: 'success',
		pending: 'warning',
		error: 'error',
		info: 'info',
		default: 'neutral'
	};

	let { tone = 'default', class: className, children, ...rest }: Props = $props();
</script>

<span class={['badge', className]} data-tone={COLOUR[tone]} {...rest}>
	{@render children?.()}
</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: var(--space-1) var(--space-2);
		border-radius: var(--radius-full);
		font-size: var(--text-xs);
		font-weight: var(--text-xs-weight);
		line-height: var(--leading-label);
		white-space: nowrap;
	}

	[data-tone='brand'] {
		background: var(--color-brand-tint);
		color: var(--color-brand-strong);
	}

	[data-tone='success'] {
		background: var(--color-success-tint);
		color: var(--color-success);
	}

	[data-tone='warning'] {
		background: var(--color-warning-tint);
		color: var(--color-warning);
	}

	[data-tone='error'] {
		background: var(--color-error-tint);
		color: var(--color-error);
	}

	[data-tone='info'] {
		background: var(--color-info-tint);
		color: var(--color-info);
	}

	[data-tone='neutral'] {
		background: var(--color-surface-2);
		color: var(--color-text-muted);
	}
</style>
