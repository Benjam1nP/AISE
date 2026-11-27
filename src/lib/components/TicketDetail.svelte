<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '$app/forms';
	import { createFormError, type FormResult } from '#lib/form-error.svelte.ts';
	import type { ProjectSnapshot } from '#lib/server/index.ts';
	import {
		Badge,
		Banner,
		Button,
		Cluster,
		Disclosure,
		Select,
		Stack,
		StatusBadge
	} from '#lib/ui/index.ts';
	import ChatMarkdown from './ChatMarkdown.svelte';
	import CodeViewer from './CodeViewer.svelte';
	import { KIND_LABEL, phaseName, STATUS_LABEL, STATUS_TONE } from './ticket-labels.ts';

	type TicketView = ProjectSnapshot['tickets'][number];
	type Props = {
		snapshot: ProjectSnapshot;
		ticket: TicketView;
		form: FormResult;
		/** An affected or changed ID was clicked (REQ, UC, SEQ, DSN). */
		onopenid: (id: string) => void;
		/** A file of the plan was clicked. */
		onopenfile: (open: { path: string }) => void;
		/** The developer should review this phase. */
		onselectphase: (phase: string) => void;
	};

	let { snapshot, ticket, form, onopenid, onopenfile, onselectphase }: Props = $props();

	/** The phases Update and Still valid exist for (the staleness cascade). */
	const STALE_PHASES = ['P2', 'P4', 'P5', 'P6'];
	const DIRECTIONS = [
		{ value: 'design', label: 'The design follows the code (P2)' },
		{ value: 'code', label: 'The code follows the design (P4)' }
	];
	const RUN_TONE = {
		running: 'new',
		done: 'active',
		failed: 'error',
		discarded: 'default'
	} as const;

	const uid = $props.id();
	const plan = $derived(ticket.plan);
	const running = $derived(snapshot.activeRun !== null);
	/** `aria-describedby` of the buttons that wait for the agent (R17): the one visible note. */
	const waiting = $derived(running ? `${uid}-wait` : undefined);
	// The detail of another ticket opens with the earlier form in place; that error is not its own.
	const planError = createFormError(() => form, ['approvePlan', 'rejectTicket'], true);
	const walkError = createFormError(
		() => form,
		['update', 'stillValid', 'closeTicket', 'approvePlan'],
		true
	);

	// Writable derived: the plan presets the choice, the developer may switch it before approving.
	let direction = $derived<string>(plan?.direction ?? (plan?.entry === 'P4' ? 'code' : 'design'));

	/** The control whose form was submitted, until the server answers. */
	let busy = $state<string>();
	const submitting =
		(key: string): SubmitFunction =>
		() => {
			busy = key;
			return async ({ update }) => {
				await update({ reset: false });
				busy = undefined;
			};
		};

	// The server's own reason (a walk phase that is not approved, or an entry run that did not finish).
	const closeReason = $derived(ticket.closeBlocked);
	let reason: HTMLElement | undefined = $state();
	// Close ticket stays enabled (R17): a click that cannot work says why and moves focus to the reason.
	const close: SubmitFunction = (input) => {
		if (closeReason) {
			input.cancel();
			reason?.focus();
			return;
		}
		return submitting('close')(input);
	};

	const nextText = {
		not_started: 'Waiting for the entry run to start.',
		running: 'The agent is working on it.',
		awaiting_approval: 'Review it and approve it. The walk goes on from there.',
		stale: 'Update it, or confirm that it is still valid.',
		approved: ''
	} as const;

	/** True when a P4 or P5 gate check says the stored results are not from the current files. */
	const resultsOld = (phase: 'P4' | 'P5') =>
		snapshot.gates[phase].checks.some(
			(c) => c.detail === 'out of date' || c.detail === 'not run yet'
		);

	/** The earlier step of the walk that must be dealt with before step `i` can be. */
	const blockerOf = (i: number) => ticket.steps.slice(0, i).find((s) => s.status !== 'approved');

	/** What the developer does next on a step, in words. */
	function next(i: number): string {
		const step = ticket.steps[i];
		const blocker = blockerOf(i);
		if (blocker && (step.status === 'awaiting_approval' || step.status === 'stale')) {
			return blocker.status === 'stale'
				? `Update ${blocker.phase} or confirm it is still valid first.`
				: `Approve ${blocker.phase} first.`;
		}
		if (step.status === 'stale' && step.phase === 'P4' && resultsOld('P4')) {
			return 'Open P4 and press Check again, then Still valid.';
		}
		return nextText[step.status];
	}

	/** Close ticket needs current test results when the walk includes P5; a hint, not a block. */
	const testHint = $derived(
		ticket.steps.some((s) => s.phase === 'P5') && resultsOld('P5')
			? 'Run the tests in the Tests tab before closing.'
			: ''
	);

	let openFiles = $state<Record<string, boolean>>({});
</script>

<Stack gap={4}>
	<header class="head">
		<Cluster gap={2} align="baseline">
			<span class="id">{ticket.id}</span>
			<span class="kind">{KIND_LABEL[ticket.kind]}</span>
			<Badge tone={STATUS_TONE[ticket.status]}>{STATUS_LABEL[ticket.status]}</Badge>
		</Cluster>
		<h3>{ticket.title}</h3>
		{#if ticket.description}<p class="text">{ticket.description}</p>{/if}
	</header>

	{#if ticket.status === 'open'}
		<p class="note">
			Waiting for a plan. The maintenance agent may ask questions in the chat below; answer its
			questions to get a plan.
		</p>
	{/if}

	{#if plan}
		<section class="block" aria-labelledby="{uid}-plan">
			<h4 id="{uid}-plan">Plan</h4>
			<p class="text">Starts in {plan.entry} {phaseName(plan.entry)}.</p>
			<ol class="steps" aria-label="Plan steps">
				{#each plan.steps as step, i (i)}<li>{step}</li>{/each}
			</ol>
			{#if plan.affectedIds.length > 0}
				<Cluster gap={1}>
					<span class="label">Affected</span>
					{#each plan.affectedIds as id (id)}
						<Button size="sm" variant="ghost" onclick={() => onopenid(id)}>{id}</Button>
					{/each}
				</Cluster>
			{/if}
			{#if plan.files.length > 0}
				<Cluster gap={1}>
					<span class="label">Files</span>
					{#each plan.files as path (path)}
						<Button size="sm" variant="ghost" onclick={() => onopenfile({ path })}>{path}</Button>
					{/each}
				</Cluster>
			{/if}
		</section>
	{/if}

	{#if ticket.status === 'triaged' || ticket.status === 'open'}
		<div class="actions">
			{#if ticket.status === 'triaged'}
				<form
					class="approve"
					method="POST"
					action="?/approvePlan"
					use:enhance={submitting('approve')}
				>
					<input type="hidden" name="ticketId" value={ticket.id} />
					{#if ticket.kind === 'drift'}
						<Select
							name="direction"
							label="Direction"
							options={DIRECTIONS}
							bind:value={direction}
						/>
					{/if}
					<Button
						type="submit"
						variant="primary"
						loading={running || busy === 'approve'}
						aria-describedby={waiting}>Approve plan</Button
					>
				</form>
			{/if}
			<form method="POST" action="?/rejectTicket" use:enhance={submitting('reject')}>
				<input type="hidden" name="ticketId" value={ticket.id} />
				<Button type="submit" loading={running || busy === 'reject'}>Reject</Button>
			</form>
		</div>
		{#if running}
			<p class="note" id="{uid}-wait">Approve plan is available when the agent finishes.</p>
		{/if}
		{#if planError.message}
			<Banner tone="error" title="That did not work">
				{planError.message}
				{#snippet actions()}
					<Button size="sm" variant="ghost" onclick={planError.dismiss}>Dismiss</Button>
				{/snippet}
			</Banner>
		{/if}
	{/if}

	{#if ticket.status === 'in_progress'}
		<section class="block" aria-labelledby="{uid}-walk">
			<h4 id="{uid}-walk">Walk</h4>
			<ol class="walk" aria-labelledby="{uid}-walk">
				{#each ticket.steps as step, i (step.phase)}
					{@const blocked = blockerOf(i) !== undefined}
					<li class="step">
						<Cluster gap={2} align="baseline">
							<span class="id">{step.phase}</span>
							<span>{phaseName(step.phase)}</span>
							<StatusBadge status={step.status} />
							{#if step.entry}<Badge tone="info">Entry phase</Badge>{/if}
						</Cluster>
						{#if next(i)}<p class="note">{next(i)}</p>{/if}
						{#if step.status === 'awaiting_approval' && !blocked}
							<div>
								<Button size="sm" variant="primary" onclick={() => onselectphase(step.phase)}
									>Review in {step.phase}</Button
								>
							</div>
						{:else if step.status === 'stale'}
							<Cluster gap={2}>
								<Button size="sm" onclick={() => onselectphase(step.phase)}
									>Open {step.phase}</Button
								>
								{#if !blocked && STALE_PHASES.includes(step.phase)}
									<form
										method="POST"
										action="?/update"
										use:enhance={submitting(`update-${step.phase}`)}
									>
										<input type="hidden" name="phase" value={step.phase} />
										<Button
											type="submit"
											variant="primary"
											size="sm"
											loading={running || busy === `update-${step.phase}`}
											aria-describedby={waiting}>Update</Button
										>
									</form>
									<form
										method="POST"
										action="?/stillValid"
										use:enhance={submitting(`valid-${step.phase}`)}
									>
										<input type="hidden" name="phase" value={step.phase} />
										<Button
											type="submit"
											size="sm"
											loading={running || busy === `valid-${step.phase}`}
											aria-describedby={waiting}>Still valid</Button
										>
									</form>
								{/if}
							</Cluster>
						{/if}
					</li>
				{/each}
			</ol>
		</section>

		{#if ticket.notReproduced}
			<Banner tone="warning" title="Not reproduced">
				The new test passes, so the bug did not show. Close the ticket to keep the test, or discard
				the runs and reject the ticket.
			</Banner>
		{/if}

		{#if running}
			<p class="note" id="{uid}-wait">These buttons are available when the agent finishes.</p>
		{/if}
		{#if testHint}<p class="note">{testHint}</p>{/if}
		<div class="actions">
			{#if !ticket.entryRan}
				<!-- The entry run failed or was interrupted: no agent saw the plan yet, so it is sent again. -->
				<form method="POST" action="?/approvePlan" use:enhance={submitting('restart')}>
					<input type="hidden" name="ticketId" value={ticket.id} />
					<Button type="submit" loading={running || busy === 'restart'} aria-describedby={waiting}
						>Start the entry run again</Button
					>
				</form>
			{/if}
			<form method="POST" action="?/closeTicket" use:enhance={close}>
				<input type="hidden" name="ticketId" value={ticket.id} />
				<Button
					type="submit"
					variant="primary"
					loading={running || busy === 'close'}
					aria-describedby={[closeReason && `${uid}-reason`, waiting].filter(Boolean).join(' ') ||
						undefined}>Close ticket</Button
				>
			</form>
		</div>
		{#if closeReason}
			<p class="note" id="{uid}-reason" tabindex="-1" bind:this={reason}>{closeReason}</p>
		{/if}
		{#if walkError.message}
			<Banner tone="error" title="That did not work">
				{walkError.message}
				{#snippet actions()}
					<Button size="sm" variant="ghost" onclick={walkError.dismiss}>Dismiss</Button>
				{/snippet}
			</Banner>
		{/if}
	{/if}

	{#if ticket.report}
		{@const report = ticket.report}
		<section class="block" aria-labelledby="{uid}-report">
			<h4 id="{uid}-report">Change report</h4>
			<ChatMarkdown text={report.text} />
			<ol class="report-steps" aria-label="Steps of the change">
				{#each report.steps as step (step.runId)}
					<li class="step">
						<Cluster gap={2} align="baseline">
							<span class="id">{step.phase}</span>
							<span>{phaseName(step.phase)}</span>
							<Badge tone={RUN_TONE[step.status]}>{step.status}</Badge>
						</Cluster>
						{#if step.summary}<p class="text">{step.summary}</p>{/if}
						{#if step.files.length > 0}
							<ul class="files">
								{#each step.files as path (path)}<li class="path">{path}</li>{/each}
							</ul>
						{/if}
					</li>
				{/each}
			</ol>
			{#if report.changedIds.length > 0}
				<Cluster gap={1}>
					<span class="label">Changed</span>
					{#each report.changedIds as id (id)}
						<Button size="sm" variant="ghost" onclick={() => onopenid(id)}>{id}</Button>
					{/each}
				</Cluster>
			{/if}
			<Cluster gap={2}>
				<span class="label">Tests</span>
				{#if report.tests}
					<span class="aise-num">{report.tests.passed} passed, {report.tests.failed} failed</span>
					{#if report.tests.outOfDate}<Badge tone="pending">out of date</Badge>{/if}
				{:else}
					<span class="note">No test result was stored.</span>
				{/if}
			</Cluster>
			{#each report.files as file (file.path)}
				<Disclosure
					summary={file.path}
					bind:open={() => openFiles[file.path] ?? false, (v) => (openFiles[file.path] = v)}
				>
					{#if openFiles[file.path]}
						<CodeViewer content={file.diff} label="Changes in {file.path}" />
					{/if}
				</Disclosure>
			{/each}
		</section>
	{/if}
</Stack>

<style>
	.head {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.block {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	h4 {
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		font-weight: var(--weight-semibold);
		letter-spacing: 0;
	}

	.id {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}

	.kind,
	.label {
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}

	.text {
		margin: 0;
		font-size: var(--text-sm);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.note {
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}

	ol,
	ul {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.steps {
		padding-left: var(--space-4);
		list-style: decimal;
		font-size: var(--text-sm);
	}

	.step {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
	}

	.path {
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		overflow-wrap: anywhere;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--space-3);
	}

	.approve {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-end;
		gap: var(--space-3);
	}
</style>
