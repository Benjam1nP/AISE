<script lang="ts">
	import { hasTestFiles } from '#lib/code-files.ts';
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

	// Only the first run: once tests exist, changes go through the chat or Update.
	const visible = $derived(!hasTestFiles(snapshot.files) && snapshot.activeRun === null);
	const p4Approved = $derived(snapshot.state.phases.P4.status === 'approved');

	const error = createFormError(() => form, ['generateTests']);
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
	<Panel title="Generate the tests">
		<Stack gap={3}>
			<p class="note">
				The test agent writes one test file per use case of the approved design, runs them, and
				sorts each failure into a wrong test or a bug in the code.
				{#if !p4Approved}
					<strong>Approve the code first.</strong>
				{/if}
			</p>
			<form method="POST" action="?/generateTests" use:enhance={generate}>
				<Button type="submit" variant="primary" loading={busy}>Generate tests</Button>
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
