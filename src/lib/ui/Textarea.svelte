<script lang="ts">
	import type { HTMLTextareaAttributes } from 'svelte/elements';
	import './controls.css';
	import FormField from './FormField.svelte';

	/** `class` styles the field wrapper; every other attribute (name, rows, placeholder) goes to the textarea. */
	type Props = Omit<HTMLTextareaAttributes, 'class' | 'value' | 'disabled'> & {
		disabled?: boolean;
		label: string;
		hint?: string;
		error?: string;
		success?: boolean | string;
		loading?: boolean;
		value?: string;
		class?: string;
	};

	let {
		label,
		hint,
		error,
		success = false,
		loading = false,
		value = $bindable(''),
		disabled = false,
		rows = 4,
		class: className,
		...rest
	}: Props = $props();
</script>

<FormField {label} {hint} {error} {success} {loading} {disabled} class={className}>
	{#snippet control(field)}
		<textarea
			{...rest}
			class="aise-control area"
			id={field.id}
			{rows}
			aria-describedby={field.describedby}
			aria-invalid={field.invalid ? 'true' : undefined}
			aria-busy={field.busy ? 'true' : undefined}
			readonly={field.busy || rest.readonly}
			{disabled}
			bind:value></textarea>
	{/snippet}
</FormField>

<style>
	.area {
		resize: vertical;
	}
</style>
