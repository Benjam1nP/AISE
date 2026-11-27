<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import type { Snippet } from 'svelte';
	import type { HTMLDialogAttributes } from 'svelte/elements';
	import IconButton from './IconButton.svelte';

	type Props = Omit<HTMLDialogAttributes, 'class' | 'children' | 'title' | 'open'> & {
		open?: boolean;
		title: string;
		children?: Snippet;
		footer?: Snippet;
		class?: string;
	};

	let {
		open = $bindable(false),
		title,
		children,
		footer,
		class: className,
		...rest
	}: Props = $props();

	const uid = $props.id();
	const titleId = `${uid}-title`;
	let dialog: HTMLDialogElement | undefined = $state();
	let opener: HTMLElement | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

	/** The exit duration in ms; 0 when the user prefers reduced motion (the token is 0ms then). */
	function exitDelay(): number {
		const value = getComputedStyle(document.documentElement).getPropertyValue('--duration-200');
		return Number.parseFloat(value) || 0;
	}

	$effect(() => {
		if (!dialog) return;
		const element = dialog;
		if (open) {
			clearTimeout(timer);
			delete element.dataset.closing;
			if (element.hasAttribute('open')) return;
			opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
			element.showModal();
			if (!element.contains(document.activeElement)) {
				(element.querySelector<HTMLElement>(FOCUSABLE) ?? element).focus();
			}
		} else if (element.hasAttribute('open') && !element.dataset.closing) {
			const finish = () => {
				delete element.dataset.closing;
				element.close();
				opener?.focus();
				opener = null;
			};
			const delay = exitDelay();
			if (delay === 0) finish();
			else {
				element.dataset.closing = '';
				timer = setTimeout(finish, delay);
			}
		}
		return () => clearTimeout(timer);
	});

	function onkeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		open = false;
	}
</script>

<!-- A click that lands on the dialog itself hit the backdrop: the content sits in .box. -->
<dialog
	{...rest}
	bind:this={dialog}
	class={['modal', className]}
	aria-labelledby={titleId}
	{onkeydown}
	oncancel={(event) => {
		event.preventDefault();
		open = false;
	}}
	onclose={() => (open = false)}
	onclick={(event) => {
		if (event.target === event.currentTarget) open = false;
	}}
>
	<div class="box">
		<header class="head">
			<h2 id={titleId}>{title}</h2>
			<IconButton icon={X} label="Close" size="sm" onclick={() => (open = false)} />
		</header>
		<div class="body">{@render children?.()}</div>
		{#if footer}<footer class="foot">{@render footer()}</footer>{/if}
	</div>
</dialog>

<style>
	.modal {
		width: min(32rem, calc(100% - var(--space-8)));
		max-height: calc(100dvh - var(--space-8));
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		background: var(--color-surface);
		color: var(--color-text);
		box-shadow: var(--shadow-md);
		overflow: hidden;
	}

	.modal[open] {
		animation: modal-in var(--duration-300) var(--ease-out);
	}

	.modal[open]::backdrop {
		animation: fade-in var(--duration-300) var(--ease-out);
	}

	.modal::backdrop {
		background: color-mix(in srgb, var(--color-bg) 70%, transparent);
	}

	.modal[data-closing] {
		animation: modal-out var(--duration-200) var(--ease-in) forwards;
	}

	.modal[data-closing]::backdrop {
		animation: fade-out var(--duration-200) var(--ease-in) forwards;
	}

	.box {
		display: flex;
		flex-direction: column;
		max-height: calc(100dvh - var(--space-8));
	}

	.head {
		display: flex;
		flex: none;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		padding: var(--space-4) var(--space-4) var(--space-4) var(--space-6);
		border-bottom: 1px solid var(--color-border);
	}

	.body {
		flex: 1;
		min-height: 0;
		padding: var(--space-6);
		overflow: auto;
	}

	/* A scrollable body is focusable; the dialog clips an outside ring. */
	.body:focus-visible {
		outline-offset: -2px;
	}

	.foot {
		display: flex;
		flex: none;
		justify-content: flex-end;
		gap: var(--space-2);
		padding: var(--space-4) var(--space-6);
		border-top: 1px solid var(--color-border);
	}

	@keyframes modal-in {
		from {
			opacity: 0;
			transform: translateY(var(--space-2));
		}
	}

	@keyframes modal-out {
		to {
			opacity: 0;
			transform: translateY(var(--space-2));
		}
	}

	@keyframes fade-in {
		from {
			opacity: 0;
		}
	}

	@keyframes fade-out {
		to {
			opacity: 0;
		}
	}
</style>
