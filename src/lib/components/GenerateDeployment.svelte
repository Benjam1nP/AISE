<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '$app/forms';
	import { hasDeployFiles } from '#lib/code-files.ts';
	import { createFormError, type FormResult } from '#lib/form-error.svelte.ts';
	import type { ProjectSnapshot } from '#lib/server/index.ts';
	import { Banner, Button, Panel, Stack } from '#lib/ui/index.ts';

	type Props = {
		snapshot: ProjectSnapshot;
		form: FormResult;
	};

	let { snapshot, form }: Props = $props();

	// Only the first run: once deploy files exist, changes go through the chat or Update.
	const visible = $derived(!hasDeployFiles(snapshot.files) && snapshot.activeRun === null);
	const p5Approved = $derived(snapshot.state.phases.P5.status === 'approved');

	const error = createFormError(() => form, ['generateDeployment']);
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
	<Panel title="Generate the deployment">
		<Stack gap={3}>
			<p class="note">
				The deploy agent writes a Dockerfile, a compose file and a RUN.md from the approved design,
				then starts the stack and checks that every service answers its health url.
				{#if !p5Approved}
					<strong>Approve the tests first.</strong>
				{/if}
			</p>
			<form method="POST" action="?/generateDeployment" use:enhance={generate}>
				<Button type="submit" variant="primary" loading={busy}>Generate deployment</Button>
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
