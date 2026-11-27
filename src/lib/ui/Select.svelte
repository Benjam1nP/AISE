<script lang="ts">
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
	import type { HTMLSelectAttributes } from 'svelte/elements';
	import './controls.css';
	import FormField from './FormField.svelte';
	import Icon from './Icon.svelte';

	/** `class` styles the field wrapper; every other attribute (name, required) goes to the select. */
	type Props = Omit<HTMLSelectAttributes, 'class' | 'value' | 'children' | 'disabled'> & {
		disabled?: boolean;
		label: string;
		options: { value: string; label: string }[];
		hint?: string;
		error?: string;
		success?: boolean | string;
		value?: string;
		class?: string;
	};

	let {
		label,
		options,
		hint,
		error,
		success = false,
		value = $bindable(''),
		disabled = false,
		class: className,
		...rest
	}: Props = $props();
</script>

<FormField {label} {hint} {error} {success} trailing {disabled} class={className}>
	{#snippet control(field)}
		<span class="wrap">
			<select
				{...rest}
				class="aise-control select"
				id={field.id}
				aria-describedby={field.describedby}
				aria-invalid={field.invalid ? 'true' : undefined}
				{disabled}
				bind:value
			>
				{#each options as option (option.value)}
					<option value={option.value}>{option.label}</option>
				{/each}
			</select>
			<Icon icon={ChevronDown} size={16} class="chevron" />
		</span>
	{/snippet}
</FormField>

<style>
	.wrap {
		position: relative;
		display: block;
	}

	.select {
		appearance: none;
		cursor: pointer;
	}

	.select:disabled {
		cursor: not-allowed;
	}

	.wrap :global(.chevron) {
		position: absolute;
		top: 50%;
		right: var(--space-3);
		transform: translateY(-50%);
		color: var(--color-text-muted);
		pointer-events: none;
	}
</style>
