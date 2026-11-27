<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import Tabs from './Tabs.svelte';

	type Props = Omit<HTMLAttributes<HTMLDivElement>, 'class' | 'children'> & {
		left: Snippet;
		right: Snippet;
		/** Tab labels shown below `md`, where one pane is visible at a time. */
		leftLabel?: string;
		rightLabel?: string;
		/** From `md` up (and 640 px high) the left pane stays in view under the AppShell header and fills the screen height. */
		stickLeft?: boolean;
		/** The pane shown below `md`: `left` or `right`. The parent may switch it. */
		active?: 'left' | 'right';
		class?: string;
	};

	let {
		left,
		right,
		leftLabel = 'Chat',
		rightLabel = 'Artefacts',
		stickLeft = false,
		active = $bindable('left'),
		class: className,
		...rest
	}: Props = $props();
</script>

<div class={['split', className]} {...rest}>
	<Tabs
		class="switch"
		tabs={[
			{ id: 'left', label: leftLabel },
			{ id: 'right', label: rightLabel }
		]}
		bind:active={() => active, (v) => (active = v === 'right' ? 'right' : 'left')}
	/>
	<div class={['pane', 'left', active === 'left' && 'shown', stickLeft && 'stick']}>
		{@render left()}
	</div>
	<div class={['pane', 'right', active === 'right' && 'shown']}>{@render right()}</div>
</div>

<style>
	.split {
		display: grid;
		grid-template-columns: repeat(var(--grid-columns), minmax(0, 1fr));
		column-gap: var(--grid-gutter);
		row-gap: var(--space-4);
		min-height: 0;
	}

	.split > :global(.switch),
	.pane {
		grid-column: 1 / -1;
		min-width: 0;
		min-height: 0;
	}

	.pane:not(.shown) {
		display: none;
	}

	@media (min-width: 960px) {
		.split > :global(.switch) {
			display: none;
		}

		.pane:not(.shown) {
			display: block;
		}

		.left {
			grid-column: span 5;
		}

		.right {
			grid-column: span 7;
		}
	}

	/* Only on screens tall enough for the composer; lower, the pane scrolls with the page. */
	@media (min-width: 960px) and (min-height: 640px) {
		.stick {
			position: sticky;
			top: calc(var(--shell-top, 0px) + var(--space-6));
			align-self: start;
			height: calc(100dvh - var(--shell-top, 0px) - var(--space-6) * 2);
		}

		.stick > :global(*) {
			height: 100%;
		}
	}
</style>
