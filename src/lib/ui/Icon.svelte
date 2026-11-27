<script lang="ts">
	import type { LucideIcon } from '@lucide/svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	type Props = Omit<HTMLAttributes<HTMLSpanElement>, 'class'> & {
		icon: LucideIcon;
		size?: 16 | 20 | 24 | 32 | 48;
		class?: string;
	};

	let { icon: Glyph, size = 20, class: className, ...rest }: Props = $props();
</script>

<span class={['icon', `s${size}`, className]} aria-hidden="true" {...rest}>
	<Glyph size="100%" />
</span>

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
