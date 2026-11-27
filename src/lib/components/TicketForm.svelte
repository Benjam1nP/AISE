<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '$app/forms';
	import { tick } from 'svelte';
	import { createFormError, type FormResult } from '#lib/form-error.svelte.ts';
	import {
		Banner,
		Button,
		createFieldValidation,
		Input,
		Select,
		Stack,
		Textarea
	} from '#lib/ui/index.ts';

	type Props = {
		form: FormResult;
		/** An agent run is active; creating a ticket starts one, so Create ticket waits (R17). */
		running?: boolean;
		/** Called once the server accepted the ticket. */
		ondone?: () => void;
		/** The description; the page keeps it, so IDs clicked in a diagram land in it. */
		description?: string;
	};

	let { form, running = false, ondone, description = $bindable('') }: Props = $props();
	const uid = $props.id();

	const KINDS = [
		{ value: 'change', label: 'Change request' },
		{ value: 'requirement', label: 'New requirement' },
		{ value: 'bug', label: 'Bug' },
		{ value: 'drift', label: 'Drift' }
	];

	let kind = $state('change');
	const title = createFieldValidation((v) =>
		v.trim() === '' ? 'Give the ticket a short title.' : undefined
	);
	let creating = $state(false);
	let element: HTMLFormElement | undefined = $state();
	// An error from before the form opened is old news.
	const error = createFormError(() => form, ['createTicket'], true);

	/** Puts the cursor on the first field; the panel calls it when the form opens. */
	export function focus(): void {
		element?.querySelector<HTMLElement>('select')?.focus();
	}

	const create: SubmitFunction = ({ cancel }) => {
		// An empty title is not sent; the field names the problem and takes the focus (R17, R18).
		if (!title.check()) {
			cancel();
			void tick().then(() => element?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
			return;
		}
		creating = true;
		return async ({ result, update }) => {
			await update({ reset: false });
			creating = false;
			if (result.type === 'success') {
				title.reset();
				description = '';
				ondone?.();
			}
		};
	};
</script>

<form method="POST" action="?/createTicket" bind:this={element} use:enhance={create}>
	<Stack gap={3}>
		<Select name="kind" label="Kind" options={KINDS} bind:value={kind} />
		<Input
			name="title"
			label="Title"
			autocomplete="off"
			bind:value={title.value}
			error={title.error}
			onblur={title.onblur}
			oninput={title.oninput}
		/>
		<Textarea
			name="description"
			label="Description"
			hint="What should change, or what goes wrong. The maintenance agent asks if it is unclear."
			rows={4}
			bind:value={description}
		/>
		{#if error.message}
			<Banner tone="error" title="That did not work">
				{error.message}
				{#snippet actions()}
					<Button size="sm" variant="ghost" onclick={error.dismiss}>Dismiss</Button>
				{/snippet}
			</Banner>
		{/if}
		<div>
			<Button
				type="submit"
				variant="primary"
				loading={running || creating}
				aria-describedby={running ? `${uid}-wait` : undefined}>Create ticket</Button
			>
		</div>
		{#if running}
			<p class="note" id="{uid}-wait">Create ticket is available when the agent finishes.</p>
		{/if}
	</Stack>
</form>

<style>
	.note {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
</style>
