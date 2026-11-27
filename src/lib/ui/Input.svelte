<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import './controls.css';
	import FormField from './FormField.svelte';

	/** `class` styles the field wrapper; every other attribute (type, name, placeholder) goes to the input. */
	type Props = Omit<HTMLInputAttributes, 'class' | 'value' | 'disabled'> & {
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
		class: className,
		...rest
	}: Props = $props();
</script>

<FormField {label} {hint} {error} {success} {loading} {disabled} class={className}>
	{#snippet control(field)}
		<input
			{...rest}
			class="aise-control"
			id={field.id}
			aria-describedby={field.describedby}
			aria-invalid={field.invalid ? 'true' : undefined}
			aria-busy={field.busy ? 'true' : undefined}
			readonly={field.busy || rest.readonly}
			{disabled}
			bind:value
		/>
	{/snippet}
</FormField>
