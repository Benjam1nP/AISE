<script lang="ts">
	import type { LucideIcon } from '@lucide/svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import Button from './Button.svelte';
	import Icon from './Icon.svelte';

	type Props = Omit<HTMLButtonAttributes, 'class' | 'children' | 'aria-label'> & {
		icon: LucideIcon;
		/** Accessible name, required because the button has no text. */
		label: string;
		size?: 'sm' | 'md' | 'lg';
		variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
		loading?: boolean;
		class?: string;
	};

	let { icon, label, size = 'md', variant = 'ghost', ...rest }: Props = $props();
</script>

<Button {...rest} {size} {variant} square aria-label={label} title={rest.title ?? label}>
	<Icon {icon} size={size === 'sm' ? 16 : 20} />
</Button>
