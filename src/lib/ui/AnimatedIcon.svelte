<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import { ANIMATED_ICONS, finalFrame, type AnimatedIconName } from './animated-icons.ts';

	type Props = Omit<HTMLAttributes<HTMLSpanElement>, 'class' | 'aria-hidden'> & {
		/** Undefined draws nothing; a later name then draws itself. */
		name: AnimatedIconName | undefined;
		size?: 16 | 20 | 24 | 32 | 48;
		class?: string;
	};

	let { name, size = 20, class: className, ...rest }: Props = $props();

	// Only a change of `name` on a mounted icon plays: a mount (page load, tab switch) shows the final frame.
	let mounted = false;
	let play = $state(false);
	$effect.pre(() => {
		void name;
		if (mounted) play = !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
		mounted = true;
	});

	const body = $derived(name && (play ? ANIMATED_ICONS[name] : finalFrame(ANIMATED_ICONS[name])));

	/** A new svg starts its own animation clock; rewind it in case the browser shares one. No-op on a final frame. */
	const rewind = (svg: SVGSVGElement) => {
		svg.setCurrentTime?.(0);
	};
</script>

{#if name}
	<span
		{...rest}
		class={['icon', `s${size}`, className]}
		aria-hidden="true"
		data-icon={name}
		data-play={play ? '' : undefined}
	>
		{#key name}
			<svg viewBox="0 0 24 24" width="100%" height="100%" {@attach rewind}>
				<!-- eslint-disable-next-line svelte/no-at-html-tags -- static icon markup from animated-icons.ts -->
				{@html body}
			</svg>
		{/key}
	</span>
{/if}

<style>
	.icon {
		display: inline-flex;
		flex: none;
	}

	.s16 {
		width: var(--icon-16);
		height: var(--icon-16);
	}

	.s20 {
		width: var(--icon-20);
		height: var(--icon-20);
	}

	.s24 {
		width: var(--icon-24);
		height: var(--icon-24);
	}

	.s32 {
		width: var(--icon-32);
		height: var(--icon-32);
	}

	.s48 {
		width: var(--icon-48);
		height: var(--icon-48);
	}
</style>
