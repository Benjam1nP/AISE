<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import Spinner from './Spinner.svelte';

	type Props = Omit<HTMLButtonAttributes, 'class' | 'children'> & {
		variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
		size?: 'sm' | 'md' | 'lg';
		loading?: boolean;
		/** Width equals height. IconButton sets it. */
		square?: boolean;
		class?: string;
		children?: Snippet;
	};

	let {
		variant = 'secondary',
		size = 'md',
		disabled = false,
		loading = false,
		square = false,
		type = 'button',
		onclick,
		class: className,
		children,
		...rest
	}: Props = $props();
</script>

<button
	{...rest}
	{type}
	{disabled}
	class={['btn aise-hit', variant, size, square && 'square', className]}
	aria-busy={loading ? 'true' : undefined}
	onclick={(event) => {
		if (loading) {
			event.preventDefault();
			return;
		}
		onclick?.(event);
	}}
>
	{#if loading}<Spinner size={16} label="" />{/if}
	{#if !(square && loading)}{@render children?.()}{/if}
</button>

<style>
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		font-weight: var(--weight-medium);
		line-height: var(--leading-label);
		white-space: nowrap;
		cursor: pointer;
		transition:
			background-color var(--duration-100) var(--ease-out),
			border-color var(--duration-100) var(--ease-out),
			color var(--duration-100) var(--ease-out),
			transform var(--duration-200) var(--ease-out);
	}

	.sm {
		height: var(--space-8);
		padding-inline: var(--space-3);
		font-size: var(--text-sm);
	}

	.md {
		height: calc(var(--space-8) + var(--space-2));
		padding-inline: var(--space-4);
		font-size: var(--text-base);
	}

	.lg {
		height: var(--space-12);
		padding-inline: var(--space-6);
		font-size: var(--text-lg);
	}

	.square {
		padding-inline: 0;
	}

	.square.sm {
		width: var(--space-8);
	}

	.square.md {
		width: calc(var(--space-8) + var(--space-2));
	}

	.square.lg {
		width: var(--space-12);
	}

	.btn:active:not(:disabled) {
		transform: translateY(1px);
	}

	.primary,
	.destructive {
		--spinner-color: currentColor;
	}

	.primary {
		background: var(--color-brand-strong);
		color: var(--color-on-brand);
	}

	.primary:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-brand-strong) 88%, var(--color-text));
	}

	.primary:active:not(:disabled) {
		background: color-mix(in srgb, var(--color-brand-strong) 76%, var(--color-text));
	}

	.secondary {
		border-color: var(--color-border-strong);
		background: var(--color-surface);
		color: var(--color-text);
	}

	.secondary:hover:not(:disabled) {
		background: var(--color-surface-2);
	}

	.secondary:active:not(:disabled) {
		border-color: var(--color-text-muted);
		background: var(--color-surface-2);
	}

	.ghost {
		background: transparent;
		color: var(--color-text);
	}

	.ghost:hover:not(:disabled) {
		background: var(--color-surface-2);
	}

	.ghost:active:not(:disabled) {
		background: var(--color-border);
	}

	.destructive {
		background: var(--color-error);
		color: var(--color-on-brand);
	}

	.destructive:hover:not(:disabled) {
		background: color-mix(in srgb, var(--color-error) 88%, var(--color-text));
	}

	.destructive:active:not(:disabled) {
		background: color-mix(in srgb, var(--color-error) 76%, var(--color-text));
	}

	.btn:disabled {
		border-color: var(--color-border);
		background: var(--color-surface-2);
		color: var(--color-text-soft);
		cursor: not-allowed;
	}

	.btn[aria-busy='true'] {
		cursor: progress;
	}
</style>
