<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	type Props = Omit<HTMLAttributes<HTMLDivElement>, 'class' | 'children'> & {
		header: Snippet;
		/** Rendered inside a 12 column grid; direct children span all columns unless they set `grid-column`. */
		main: Snippet;
		/** A second header row, for example the phase rail. */
		subheader?: Snippet;
		footer?: Snippet;
		/** Draws a faint drafting dot grid behind the main area. */
		grid?: boolean;
		class?: string;
	};

	let {
		header,
		subheader,
		main,
		footer,
		grid = false,
		class: className,
		...rest
	}: Props = $props();

	/** The height of the sticky header, as `--shell-top`, so sticky content below it can start under it. */
	let top = $state(0);
</script>

<div class={['shell', className]} style:--shell-top="{top}px" {...rest}>
	<header class="top" bind:offsetHeight={top}>
		<div class="header">{@render header()}</div>
		{#if subheader}<div class="subheader">{@render subheader()}</div>{/if}
	</header>
	<main class={['main', grid && 'grid']}>{@render main()}</main>
	{#if footer}<footer class="footer">{@render footer()}</footer>{/if}
</div>

<style>
	.shell {
		display: grid;
		grid-template-rows: auto 1fr auto;
		grid-template-columns: minmax(0, 1fr);
		min-height: 100dvh;
	}

	.header,
	.subheader,
	.footer {
		padding-inline: var(--page-margin);
	}

	.top {
		position: sticky;
		top: 0;
		z-index: var(--z-dropdown);
		border-bottom: 1px solid var(--color-border);
		background: var(--color-surface);
		box-shadow: var(--shadow-sm);
	}

	.header {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		min-height: calc(var(--space-12) + var(--space-2));
	}

	.subheader {
		padding-bottom: var(--space-2);
	}

	.main {
		display: grid;
		grid-template-columns: repeat(var(--grid-columns), minmax(0, 1fr));
		align-content: start;
		column-gap: var(--grid-gutter);
		min-width: 0;
		padding: var(--space-6) var(--page-margin) var(--space-12);
	}

	.grid {
		background-image: radial-gradient(var(--color-grid) 1px, transparent 1px);
		background-size: var(--space-6) var(--space-6);
		background-position: calc(var(--page-margin) - var(--space-3)) var(--space-3);
	}

	.main > :global(*) {
		grid-column: 1 / -1;
		min-width: 0;
	}

	.footer {
		padding-block: var(--space-3);
		border-top: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
</style>
