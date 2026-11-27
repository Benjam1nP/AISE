<script lang="ts">
	import { hasCodeFiles } from '#lib/code-files.ts';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '$app/forms';
	import { createFormError, type FormResult } from '#lib/form-error.svelte.ts';
	import type { ProjectSnapshot } from '#lib/server/index.ts';
	import { Banner, Button, Panel, Stack } from '#lib/ui/index.ts';

	type Props = {
		snapshot: ProjectSnapshot;
		form: FormResult;
	};

	let { snapshot, form }: Props = $props();

	// Only the first run: once code exists, changes go through the chat or Update.
	const visible = $derived(!hasCodeFiles(snapshot.files) && snapshot.activeRun === null);
	const p2Approved = $derived(snapshot.state.phases.P2.status === 'approved');

	const error = createFormError(() => form, ['generate']);
	let busy = $state(false);

	const generate: SubmitFunction = () => {
		busy = true;
		return async ({ update }) => {
			await update({ reset: false });
			busy = false;
		};
	};
</script>

{#if visible}
	<Panel title="Generate the code">
		<Stack gap={3}>
			<p class="note">
				The code agent writes one file per class of the approved design, then checks the result.
				{#if !p2Approved}
					<strong>Approve the design first.</strong>
				{/if}
			</p>
			<form method="POST" action="?/generate" use:enhance={generate}>
				<Button type="submit" variant="primary" loading={busy}>Generate code</Button>
			</form>
			{#if error.message}
				<Banner tone="error" title="That did not work">
					{error.message}
					{#snippet actions()}
						<Button size="sm" variant="ghost" onclick={error.dismiss}>Dismiss</Button>
					{/snippet}
				</Banner>
			{/if}
		</Stack>
	</Panel>
{/if}

<style>
	.note {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}
</style>
