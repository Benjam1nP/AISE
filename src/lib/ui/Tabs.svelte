<script lang="ts" module>
	export type TabItem = { id: string; label: string; disabled?: boolean; hint?: string };
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	type Props = Omit<HTMLAttributes<HTMLDivElement>, 'class' | 'children'> & {
		tabs: TabItem[];
		active: string;
		/** Optional tab panel for the active tab; without it the parent renders the content. */
		children?: Snippet<[string]>;
		class?: string;
	};

	let { tabs, active = $bindable(), class: className, children, ...rest }: Props = $props();

	const uid = $props.id();
	let list: HTMLDivElement | undefined = $state();

	const tabId = (id: string) => `${uid}-tab-${id}`;
	const enabled = $derived(tabs.filter((tab) => !tab.disabled));
	/** The one tab in the tab order: the active one, else the first enabled one. */
	const stop = $derived(enabled.find((tab) => tab.id === active)?.id ?? enabled[0]?.id);

	function activate(id: string) {
		active = id;
		list?.querySelector<HTMLElement>(`[id="${tabId(id)}"]`)?.focus();
	}

	function onkeydown(event: KeyboardEvent, id: string) {
		const at = enabled.findIndex((tab) => tab.id === id);
		const last = enabled.length - 1;
		const target =
			event.key === 'ArrowRight'
				? enabled[at === last ? 0 : at + 1]
				: event.key === 'ArrowLeft'
					? enabled[at <= 0 ? last : at - 1]
					: event.key === 'Home'
						? enabled[0]
						: event.key === 'End'
							? enabled[last]
							: undefined;
		if (!target) return;
		event.preventDefault();
		activate(target.id);
	}
</script>

<div class={['tabs', className]} {...rest}>
	<div class="list" role="tablist" bind:this={list}>
		{#each tabs as tab (tab.id)}
			<button
				type="button"
				role="tab"
				class="tab"
				id={tabId(tab.id)}
				aria-selected={tab.id === active}
				aria-disabled={tab.disabled ? 'true' : undefined}
				aria-controls={children ? `${uid}-panel` : undefined}
				tabindex={tab.id === stop ? 0 : -1}
				title={tab.hint}
				onclick={() => !tab.disabled && activate(tab.id)}
				onkeydown={(event) => onkeydown(event, tab.id)}
			>
				{tab.label}
			</button>
		{/each}
	</div>
	{#if children}
		<div
			class="panel"
			role="tabpanel"
			id="{uid}-panel"
			aria-labelledby={tabId(active)}
			tabindex="0"
		>
			{@render children(active)}
		</div>
	{/if}
</div>

<style>
	.list {
		display: flex;
		gap: var(--space-1);
		/* An inset line, not a border: the selected tab's underline covers it without overflowing the list. */
		box-shadow: inset 0 -1px 0 var(--color-border);
		overflow-x: auto;
	}

	.tab {
		flex: none;
		min-height: var(--hit-area);
		padding-inline: var(--space-4);
		border: 0;
		border-bottom: 2px solid transparent;
		background: transparent;
		color: var(--color-text-muted);
		font-weight: var(--weight-medium);
		cursor: pointer;
		transition:
			color var(--duration-100) var(--ease-out),
			background-color var(--duration-100) var(--ease-out),
			border-color var(--duration-100) var(--ease-out);
	}

	/* The list scrolls, so an outside ring would be clipped. */
	.tab:focus-visible {
		outline-offset: -2px;
	}

	.tab:hover:not([aria-disabled='true']) {
		background: var(--color-surface-2);
		color: var(--color-text);
	}

	.tab:active:not([aria-disabled='true']) {
		background: var(--color-border);
	}

	.tab[aria-selected='true'] {
		border-bottom-color: var(--color-brand);
		color: var(--color-text);
	}

	.tab[aria-disabled='true'] {
		color: var(--color-text-soft);
		cursor: not-allowed;
	}

	.panel {
		padding-top: var(--space-4);
	}
</style>
