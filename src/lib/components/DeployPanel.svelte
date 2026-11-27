<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '$app/forms';
	import { DEPLOY_FILES, hasDeployFiles } from '#lib/code-files.ts';
	import type { ProjectSnapshot } from '#lib/server/index.ts';
	import {
		Badge,
		Button,
		Cluster,
		Disclosure,
		Stack,
		Table,
		type TableColumn
	} from '#lib/ui/index.ts';
	import CodePanel from './CodePanel.svelte';

	type Props = {
		/** A rejected Run deploy check shows in the gate panel, which the page renders for every phase, so the tab takes no `form` and shows no banner. */
		snapshot: ProjectSnapshot;
	};

	let { snapshot }: Props = $props();

	const deployFiles = $derived(DEPLOY_FILES.filter((f) => snapshot.files.includes(f)));
	/** CodePanel lists `snapshot.files`; here that is the deploy files only. */
	const deploySnapshot = $derived({ ...snapshot, files: deployFiles });
	const check = $derived(snapshot.deployCheck);
	const running = $derived(snapshot.activeRun !== null);
	const outOfDate = $derived(
		snapshot.gates.P6.checks.some((c) => c.detail === 'out of date') && check !== null
	);

	let checking = $state(false);
	const runCheck: SubmitFunction = () => {
		checking = true;
		return async ({ update }) => {
			await update({ reset: false });
			checking = false;
		};
	};

	const COLUMNS: TableColumn[] = [
		{ key: 'service', label: 'Service' },
		{ key: 'status', label: 'Status', width: '8rem' },
		{ key: 'url', label: 'URL' }
	];
	/** One row per probed url; the service is the planned one with that health url, empty when none is. */
	const rows = $derived(
		(check?.services ?? []).map((s) => ({
			service: snapshot.deployServices.find((p) => p.healthUrl === s.url)?.name ?? '',
			url: s.url,
			status: s.status
		}))
	);

	const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
	const answered = (status: number | null) => status !== null && status >= 200 && status <= 299;
</script>

<Stack gap={4}>
	{#if hasDeployFiles(snapshot.files)}
		<Cluster gap={3} align="center" justify="between">
			<Cluster gap={2} align="center">
				{#if check}
					<Badge tone={check.passed ? 'active' : 'error'}
						>{check.passed ? 'Passed' : 'Failed'}</Badge
					>
					<span class="meta aise-num">Took {seconds(check.durationMs)}</span>
				{/if}
				{#if outOfDate}
					<Badge tone="pending">out of date</Badge>
				{/if}
			</Cluster>
			<form class="run" method="POST" action="?/checkDeploy" use:enhance={runCheck}>
				<Button type="submit" size="sm" loading={running || checking || snapshot.deployCheckRunning}
					>Run deploy check</Button
				>
				<p class="note">Builds and starts the stack; this can take a few minutes.</p>
			</form>
		</Cluster>

		{#if outOfDate}
			<p class="note">This result describes older files. Run the deploy check to update it.</p>
		{/if}

		{#if check}
			<Table columns={COLUMNS} {rows}>
				{#snippet cell({ row, column })}
					{#if column.key === 'status'}
						{@const status = row.status as number | null}
						<Badge tone={answered(status) ? 'active' : 'error'}>{status ?? 'no answer'}</Badge>
					{:else}
						<span class={column.key === 'url' ? 'url' : undefined}>{row[column.key]}</span>
					{/if}
				{/snippet}
			</Table>
			{#if check.logTail.trim() !== ''}
				<Disclosure summary="Log tail">
					<pre class="log">{check.logTail}</pre>
				</Disclosure>
			{/if}
		{:else}
			<p class="note">
				The deployment has not been checked yet. Run the deploy check to see if every service
				answers.
			</p>
		{/if}

		<section class="viewer" aria-label="Deployment files">
			<CodePanel snapshot={deploySnapshot} />
		</section>
	{:else}
		<p class="note">There are no deployment files yet.</p>
	{/if}
</Stack>

<style>
	.meta,
	.note {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}

	/* The note sits under the button it explains. */
	.run {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: var(--space-1);
	}

	.run .note {
		margin: 0;
	}

	/* Status comes before the url, which wraps on a narrow screen, so the status stays in view. */
	.url {
		font-family: var(--font-mono);
		overflow-wrap: anywhere;
	}

	.log {
		max-height: 16rem;
		margin: 0;
		overflow: auto;
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.viewer {
		padding-top: var(--space-4);
		border-top: 1px solid var(--color-border);
	}
</style>
