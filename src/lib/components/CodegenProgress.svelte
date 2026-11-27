<script lang="ts">
	import Circle from '@lucide/svelte/icons/circle';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import { WIRING_ROW } from '#lib/live-run.ts';
	import type { FileStatus } from '#lib/server/codegen/generate.ts';
	import { AnimatedIcon, Icon, Spinner } from '#lib/ui/index.ts';

	type Props = {
		/** The state of every planned file, by project relative path. */
		files: Record<string, FileStatus>;
	};

	let { files }: Props = $props();

	// Attempts per file: two with the worker model, the third with the stronger one (spec 5.3).
	const LABEL: Record<FileStatus, string> = {
		planned: 'planned',
		writing: 'writing',
		checking: 'checking',
		retrying: 'retrying (attempt 2)',
		escalated: 'escalated (attempt 3)',
		ok: 'ok',
		failed: 'failed'
	};

	// The wiring step reports itself under its own row name; every other entry is a class file.
	const entries = $derived(Object.entries(files).filter(([path]) => path !== WIRING_ROW));
	const wiring = $derived(files[WIRING_ROW]);
	const done = $derived(entries.filter(([, s]) => s === 'ok' || s === 'failed').length);
</script>

{#snippet glyph(status: FileStatus)}
	{#if status === 'writing' || status === 'checking'}
		<Spinner size={16} label="" />
	{:else if status === 'retrying' || status === 'escalated'}
		<Icon icon={RotateCw} size={16} />
	{:else if status === 'planned'}
		<Icon icon={Circle} size={16} />
	{/if}
	<!-- Stays mounted per row, so the check or alert draws itself when the file finishes. -->
	<AnimatedIcon
		name={status === 'ok' ? 'check' : status === 'failed' ? 'circle-alert' : undefined}
		size={16}
	/>
{/snippet}

<div class="progress">
	{#if entries.length === 0}
		<p class="summary" role="status"><Spinner size={16} label="" /> Planning the files.</p>
	{:else}
		<p class="summary" role="status">
			<span class="aise-num">{done} of {entries.length}</span> files finished
		</p>
	{/if}
	<ol class="rows" aria-label="Files being generated">
		{#each entries as [path, status] (path)}
			<li class="row" data-status={status}>
				{@render glyph(status)}
				<span class="path">{path}</span>
				<span class="state">{LABEL[status]}</span>
			</li>
		{/each}
		{#if wiring}
			<li class="row" data-status={wiring}>
				{@render glyph(wiring)}
				<span class="path">Wiring in src/app/ and public/</span>
				<span class="state">{LABEL[wiring]}</span>
			</li>
		{/if}
	</ol>
</div>

<style>
	/* The same fixed height as CodePanel, which takes its place when the run ends: the page keeps its
	   height while files are added and when the run finishes. */
	.progress {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	/* Below this width CodePanel has no fixed height either (its tree stacks above the code). */
	@media (min-width: 640px) {
		.progress {
			height: 70dvh;
		}
	}

	.summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}

	.rows {
		display: flex;
		flex-direction: column;
		min-height: 0;
		margin: 0;
		padding: 0;
		overflow: auto;
		list-style: none;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
	}

	.row {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}

	.row + .row {
		border-top: 1px solid var(--color-border);
	}

	.path {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		color: var(--color-text);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.state {
		flex: none;
		font-size: var(--text-xs);
		font-weight: var(--text-xs-weight);
	}

	.row[data-status='writing'],
	.row[data-status='checking'] {
		color: var(--color-brand-strong);
	}

	.row[data-status='retrying'],
	.row[data-status='escalated'] {
		color: var(--color-warning);
	}

	.row[data-status='ok'] {
		color: var(--color-success);
	}

	.row[data-status='failed'] {
		color: var(--color-error);
	}
</style>
