<script lang="ts" module>
	export type DropdownItem = {
		id: string;
		label: string;
		icon?: import('@lucide/svelte').LucideIcon;
		destructive?: boolean;
		disabled?: boolean;
	};
</script>

<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import { tick } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import Button from './Button.svelte';
	import Icon from './Icon.svelte';

	type Props = Omit<HTMLAttributes<HTMLDivElement>, 'class' | 'onselect'> & {
		label: string;
		items: DropdownItem[];
		onselect: (id: string) => void;
		/** Which edge of the button the menu lines up with. */
		align?: 'start' | 'end';
		class?: string;
	};

	let { label, items, onselect, align = 'start', class: className, ...rest }: Props = $props();

	const uid = $props.id();
	const menuId = `${uid}-menu`;
	let root: HTMLDivElement | undefined = $state();
	let expanded = $state(false);

	const trigger = () => root?.querySelector<HTMLElement>('button[aria-haspopup]');
	const entries = () => [
		...(root?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])
	];

	async function open(at: 'first' | 'last') {
		expanded = true;
		await tick();
		const all = entries();
		(at === 'first' ? all[0] : all[all.length - 1])?.focus();
	}

	function close(returnFocus: boolean) {
		expanded = false;
		if (returnFocus) trigger()?.focus();
	}

	function onTriggerKeydown(event: KeyboardEvent) {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			open(event.key === 'ArrowDown' ? 'first' : 'last');
		}
	}

	function onMenuKeydown(event: KeyboardEvent) {
		const all = entries();
		const at = all.indexOf(document.activeElement as HTMLElement);
		const target =
			event.key === 'ArrowDown'
				? all[(at + 1) % all.length]
				: event.key === 'ArrowUp'
					? all[(at <= 0 ? all.length : at) - 1]
					: event.key === 'Home'
						? all[0]
						: event.key === 'End'
							? all[all.length - 1]
							: undefined;
		if (target) {
			event.preventDefault();
			target.focus();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			close(true);
		} else if (event.key === 'Tab') {
			close(true);
		}
	}

	function select(id: string) {
		close(true);
		onselect(id);
	}
</script>

<svelte:window
	onpointerdown={(event) => {
		if (expanded && !root?.contains(event.target as Node)) close(false);
	}}
/>

<div class={['dropdown', className]} bind:this={root} {...rest}>
	<Button
		variant="secondary"
		aria-haspopup="menu"
		aria-expanded={expanded}
		aria-controls={expanded ? menuId : undefined}
		onclick={() => (expanded ? close(false) : open('first'))}
		onkeydown={onTriggerKeydown}
	>
		{label}
		<Icon icon={ChevronDown} size={16} />
	</Button>
	{#if expanded}
		<div
			class={['menu', align]}
			role="menu"
			id={menuId}
			aria-label={label}
			tabindex="-1"
			onkeydown={onMenuKeydown}
		>
			{#each items as item (item.id)}
				<button
					type="button"
					role="menuitem"
					class={['item', item.destructive && 'destructive']}
					tabindex="-1"
					disabled={item.disabled}
					onclick={() => select(item.id)}
				>
					{#if item.icon}<Icon icon={item.icon} size={16} />{/if}
					{item.label}
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.dropdown {
		position: relative;
		display: inline-block;
	}

	.menu {
		position: absolute;
		top: 100%;
		z-index: var(--z-dropdown);
		display: flex;
		flex-direction: column;
		min-width: 100%;
		margin-top: var(--space-1);
		padding: var(--space-1);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
		box-shadow: var(--shadow-md);
		animation: menu-in var(--duration-300) var(--ease-out);
	}

	.start {
		left: 0;
	}

	.end {
		right: 0;
	}

	.item {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--hit-area);
		padding: var(--space-2) var(--space-3);
		border: 0;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--color-text);
		text-align: left;
		white-space: nowrap;
		cursor: pointer;
		transition: background-color var(--duration-100) var(--ease-out);
	}

	.item:hover:not(:disabled),
	.item:focus-visible {
		background: var(--color-surface-2);
	}

	.item:active:not(:disabled) {
		background: var(--color-border);
	}

	.item.destructive {
		color: var(--color-error);
	}

	.item:disabled {
		color: var(--color-text-soft);
		cursor: not-allowed;
	}

	@keyframes menu-in {
		from {
			opacity: 0;
			transform: translateY(calc(var(--space-1) * -1));
		}
	}
</style>
