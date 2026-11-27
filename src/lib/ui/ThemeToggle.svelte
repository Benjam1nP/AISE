<script lang="ts">
	import Moon from '@lucide/svelte/icons/moon';
	import Sun from '@lucide/svelte/icons/sun';
	import { onMount } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import IconButton from './IconButton.svelte';
	import { getTheme, setTheme, type Theme } from './theme';

	type Props = Omit<HTMLButtonAttributes, 'class' | 'children' | 'aria-label'> & { class?: string };

	let { class: className, ...rest }: Props = $props();

	let theme: Theme = $state('light');

	// Read in onMount: the server cannot know the theme, so render light first to match its HTML.
	onMount(() => {
		theme = getTheme();
	});

	function toggle() {
		theme = theme === 'dark' ? 'light' : 'dark';
		setTheme(theme);
	}
</script>

<IconButton
	{...rest}
	class={className}
	icon={theme === 'dark' ? Sun : Moon}
	label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
	onclick={toggle}
/>
