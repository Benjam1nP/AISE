<script lang="ts" module>
	export type FieldAria = {
		id: string;
		/** Ids of the hint and error text, for `aria-describedby`. Undefined when there are none. */
		describedby: string | undefined;
		invalid: boolean;
		/** True while the field is loading: the control should block edits (`readonly`) and set `aria-busy`. */
		busy: boolean;
		/** Which icon FormField draws inside the field. The error shows below the field instead. */
		status: 'loading' | 'success' | undefined;
	};
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';
	import AnimatedIcon from './AnimatedIcon.svelte';
	import Spinner from './Spinner.svelte';

	type Props = Omit<HTMLAttributes<HTMLDivElement>, 'class' | 'children'> & {
		label: string;
		hint?: string;
		/** Names the problem and the fix. Shown with an icon under the field; wins over `success`. */
		error?: string;
		/** `true` shows the check icon in the field; a string also shows that text under it. */
		success?: boolean | string;
		/** In-field spinner; the control is blocked against edits until it clears. */
		loading?: boolean;
		/** The control has its own trailing icon (a select chevron); the status icon moves left of it. */
		trailing?: boolean;
		disabled?: boolean;
		control: Snippet<[FieldAria]>;
		class?: string;
	};

	let {
		label,
		hint,
		error,
		success = false,
		loading = false,
		trailing = false,
		disabled = false,
		control,
		class: className,
		...rest
	}: Props = $props();

	const uid = $props.id();
	const id = `${uid}-control`;
	const hintId = `${uid}-hint`;
	const errorId = `${uid}-error`;
	const successId = `${uid}-success`;
	const successText = $derived(!error && typeof success === 'string' ? success : undefined);
	const status = $derived<FieldAria['status']>(
		error ? undefined : loading ? 'loading' : success ? 'success' : undefined
	);
	const describedby = $derived(
		[hint && hintId, error && errorId, successText && successId].filter(Boolean).join(' ') ||
			undefined
	);
</script>

<div class={['field', className]} {...rest}>
	<label class={['label', disabled && 'disabled']} for={id}>{label}</label>
	<div class="control" data-status={status} data-trailing={trailing ? '' : undefined}>
		{@render control({ id, describedby, invalid: Boolean(error), busy: loading, status })}
		<!-- Always mounted, so the check draws itself when the field turns success. -->
		<span class={['status', status]}>
			{#if status === 'loading'}<Spinner size={16} label="" />{/if}
			<AnimatedIcon name={status === 'success' ? 'check' : undefined} size={16} />
		</span>
	</div>
	{#if hint}<p class="hint" id={hintId}>{hint}</p>{/if}
	<p class="message error" id={errorId} aria-live="polite">
		<AnimatedIcon name={error ? 'circle-alert' : undefined} size={16} />{#if error}<span
				>{error}</span
			>{/if}
	</p>
	<p class="message success" id={successId} aria-live="polite">{successText ?? ''}</p>
</div>

<style>
	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.label {
		font-size: var(--text-sm);
		font-weight: var(--weight-medium);
		color: var(--color-text);
	}

	.label.disabled {
		color: var(--color-text-muted);
	}

	.hint {
		font-size: var(--text-sm);
		color: var(--color-text-muted);
	}

	.control {
		--status-right: var(--space-3);
		--control-pad-end: var(--space-3);
		position: relative;
	}

	.control[data-trailing] {
		--status-right: calc(var(--space-3) + var(--icon-16) + var(--space-2));
		--control-pad-end: var(--space-8);
	}

	.control[data-status] {
		--control-pad-end: calc(var(--status-right) + var(--icon-16) + var(--space-3));
	}

	.status {
		position: absolute;
		top: 0;
		right: var(--status-right);
		display: flex;
		align-items: center;
		height: var(--hit-area);
		pointer-events: none;
	}

	.status.success {
		color: var(--color-success);
	}

	.message {
		display: flex;
		align-items: flex-start;
		gap: var(--space-1);
		font-size: var(--text-sm);
	}

	.message:empty {
		display: none;
	}

	.error {
		color: var(--color-error);
	}

	.success {
		color: var(--color-success);
	}
</style>
