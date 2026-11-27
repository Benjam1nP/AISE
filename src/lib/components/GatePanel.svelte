<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Ticket from '@lucide/svelte/icons/ticket';
	import Undo2 from '@lucide/svelte/icons/undo-2';
	import { hasCodeFiles, hasDeployFiles, hasTestFiles } from '#lib/code-files.ts';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '$app/forms';
	import { createFormError, type FormResult } from '#lib/form-error.svelte.ts';
	import type { GateResult, ProjectSnapshot } from '#lib/server/index.ts';
	import {
		AnimatedIcon,
		Banner,
		Button,
		Cluster,
		Icon,
		Modal,
		Panel,
		Stack,
		StatusBadge
	} from '#lib/ui/index.ts';

	type Props = {
		snapshot: ProjectSnapshot;
		phase: 'P1' | 'P2' | 'P4' | 'P5' | 'P6';
		form: FormResult;
		/** A tsc error, difference or failing test of the P4 or P5 gate was clicked: show the file at the line. */
		onopenfile?: (open: { path: string; line?: number }) => void;
		/** The page is running the checks on its own; Check again shows busy meanwhile. */
		checking?: boolean;
		/** A drift ticket was opened: the page shows the Tickets tab. */
		onopendriftticket?: () => void;
	};

	let { snapshot, phase, form, onopenfile, checking = false, onopendriftticket }: Props = $props();

	/** What each phase approves. */
	const ARTEFACT = {
		P1: 'requirements',
		P2: 'design',
		P4: 'code',
		P5: 'tests',
		P6: 'deployment'
	} as const;
	const AGENT = { P1: 'requirements', P2: 'design', P4: 'code', P5: 'test', P6: 'deploy' } as const;
	/** What each phase is made from; its approval comes first. */
	const UPSTREAM = { P2: 'requirements', P4: 'design', P5: 'code', P6: 'tests' } as const;
	/** What an edit changes to make an approved phase stale. */
	const CHANGED = {
		P2: 'requirements',
		P4: 'design',
		P5: 'requirements or design',
		P6: 'services, start scripts or dependencies'
	} as const;
	/** The longest list of items shown under a check. */
	const MAX_ITEMS = 10;

	const status = $derived(snapshot.state.phases[phase]);
	const p1Approved = $derived(snapshot.state.phases.P1.status === 'approved');
	const p2Approved = $derived(snapshot.state.phases.P2.status === 'approved');
	const p4Approved = $derived(snapshot.state.phases.P4.status === 'approved');
	const p5Approved = $derived(snapshot.state.phases.P5.status === 'approved');
	/** The phase this one is made from is approved; P1 has none. */
	const upstreamApproved = $derived(
		phase === 'P2'
			? p1Approved
			: phase === 'P4'
				? p2Approved
				: phase === 'P5'
					? p4Approved
					: phase === 'P6'
						? p5Approved
						: true
	);
	const checks = $derived<GateResult['checks']>(
		phase === 'P6'
			? snapshot.gates.P6.checks
			: phase === 'P5'
				? snapshot.gates.P5.checks
				: phase === 'P4'
					? snapshot.gates.P4.checks
					: phase === 'P2'
						? [
								{
									label: 'Requirements approved',
									ok: p1Approved,
									...(p1Approved ? {} : { detail: 'approve P1 first' })
								},
								...snapshot.gates.P2.checks
							]
						: snapshot.gates.P1.checks
	);
	/** Failing advisory checks are warnings: they never count as failing, so they block and override nothing. */
	const failing = $derived(checks.filter((c) => !c.ok && !c.advisory));
	const running = $derived(snapshot.activeRun !== null);
	const awaiting = $derived(status.status === 'awaiting_approval');
	const onlyQuestions = $derived(failing.length === 1 && failing[0].label === 'No open questions');
	const canAnyway = $derived(phase === 'P1' && awaiting && onlyQuestions);
	const canOverride = $derived(
		phase !== 'P1' && awaiting && upstreamApproved && failing.length > 0
	);

	const lastRun = $derived(snapshot.lastRun?.phase === phase ? snapshot.lastRun : null);
	const canDiscard = $derived(
		!running &&
			snapshot.discardableRun?.phase === phase &&
			snapshot.discardableRun.status !== 'running'
	);

	// A rejected Check again or Run deploy check shows here only, so the message shows once.
	const error = createFormError(
		() => form,
		['approve', 'discard', 'checkCode', 'checkTests', 'checkDeploy', 'openDriftTicket']
	);
	let busy = $state<'approve' | 'anyway' | 'override' | 'discard' | 'check' | 'drift'>();
	let blocked = $state(false);
	let discardOpen = $state(false);
	let checklist: HTMLUListElement | undefined = $state();
	/** Check again is running, from a click or from the page opening. */
	const checkBusy = $derived(checking || busy === 'check');

	type Item = {
		key: string;
		text: string;
		detail: string;
		path?: string;
		line?: number;
		/** The end of a startup log, shown below the item. */
		log?: string;
	};
	const KIND = {
		missing_in_code: 'missing in code',
		missing_in_design: 'missing in design',
		changed: 'changed'
	} as const;

	/** Stored results are only shown while the gate says they describe the files on disk. */
	const current = $derived(
		(phase === 'P5' ? snapshot.testChecks : snapshot.checks) !== null &&
			!checks.some((c) => c.detail === 'out of date')
	);
	/** A project relative path as the gate reads it: forward slashes, no leading `./`. */
	const normalPath = (file: string) => file.replaceAll('\\', '/').replace(/^\.\//, '');
	/** The first line of a failure message. */
	const firstLine = (text: string | undefined) =>
		text?.split('\n').find((l) => l.trim() !== '') ?? 'failed';
	/** What sits under each P5 check: the tsc errors under `test/` and the failing tests. */
	const testItems = $derived.by((): Record<string, Item[]> => {
		const stored = snapshot.testChecks;
		if (!stored) return {};
		return {
			'Tests type check': (stored.typecheck?.errors ?? []).flatMap((e, i): Item[] => {
				const file = normalPath(e.file);
				// The same rule as the gate: an error in `test/`, or a global one without a file.
				if (file !== '' && !file.startsWith('test/')) return [];
				return [
					file === ''
						? { key: `tsc-${i}`, text: 'TypeScript', detail: e.message }
						: {
								key: `tsc-${i}`,
								text: `${file}:${e.line}`,
								detail: e.message,
								path: file,
								line: e.line
							}
				];
			}),
			'All tests pass': (stored.result?.tests ?? [])
				.filter((t) => t.status === 'failed')
				.map((t, i) => ({
					key: `test-${i}`,
					text: t.title,
					detail: firstLine(t.error),
					path: t.file,
					...(t.line ? { line: t.line } : {})
				}))
		};
	});
	/** What sits under each check: P4 the tsc errors and the differences from the design, P5 see `testItems`. */
	const items = $derived.by((): Record<string, Item[]> => {
		if (!current) return {};
		if (phase === 'P5') return testItems;
		const stored = snapshot.checks;
		if (phase !== 'P4' || !stored) return {};
		return {
			'Typecheck passes': (stored.typecheck?.errors ?? []).map((e, i) => ({
				key: `tsc-${i}`,
				text: `${e.file}:${e.line}`,
				detail: e.message,
				path: e.file,
				line: e.line
			})),
			'Code matches the design': stored.drift.map((d, i) => ({
				key: `drift-${i}`,
				text: d.name,
				detail: `${KIND[d.kind]}${d.details.length ? `: ${d.details.join('; ')}` : ''}`,
				...(d.file ? { path: d.file } : {}),
				...(d.line ? { line: d.line } : {})
			})),
			'App starts': (stored.start?.entries ?? [])
				.filter((e) => !e.ok)
				.map((e) => ({
					key: `start-${e.entry}`,
					text: e.entry,
					detail: e.error ?? 'failed',
					path: e.entry,
					...(e.log ? { log: e.log } : {})
				}))
		};
	});

	const label = (c: GateResult['checks'][number]) =>
		c.detail ? `${c.label} (${c.detail})` : c.label;

	const run =
		(key: NonNullable<typeof busy>): SubmitFunction =>
		() => {
			busy = key;
			return async ({ result, update }) => {
				await update({ reset: false });
				busy = undefined;
				blocked = false;
				if (key === 'discard' && result.type !== 'error') discardOpen = false;
			};
		};

	/** Opens the Tickets tab once the drift ticket exists. */
	const openDrift: SubmitFunction = () => {
		busy = 'drift';
		return async ({ result, update }) => {
			await update({ reset: false });
			busy = undefined;
			if (result.type === 'success') onopendriftticket?.();
		};
	};

	/** A failing gate does not disable Approve: the click names what blocks and moves focus there. */
	const approve: SubmitFunction = (input) => {
		if (failing.length > 0) {
			input.cancel();
			blocked = true;
			checklist?.focus();
			return;
		}
		return run('approve')(input);
	};
</script>

<Panel title="Approve the {ARTEFACT[phase]}">
	{#snippet actions()}
		{#if (phase === 'P4' && hasCodeFiles(snapshot.files)) || (phase === 'P5' && hasTestFiles(snapshot.files)) || (phase === 'P6' && hasDeployFiles(snapshot.files))}
			<form
				method="POST"
				action={phase === 'P6' ? '?/checkDeploy' : phase === 'P5' ? '?/checkTests' : '?/checkCode'}
				use:enhance={run('check')}
			>
				<Button type="submit" size="sm" loading={checkBusy}>
					<!-- The spinner takes the icon's place while the checks run. -->
					{#if !checkBusy}<Icon icon={RefreshCw} size={16} />{/if}Check again
				</Button>
			</form>
		{/if}
		{#if canDiscard}
			<Button size="sm" onclick={() => (discardOpen = true)}>
				<Icon icon={Undo2} size={16} />Discard last run
			</Button>
		{/if}
	{/snippet}

	<Stack gap={3}>
		<Cluster gap={2}>
			<StatusBadge status={status.status} />
			{#if status.override}
				<span class="note">Approved with override: {status.override.failed.join(', ')}</span>
			{/if}
		</Cluster>

		<ul class="checks" aria-label="Checks before approval" tabindex="-1" bind:this={checklist}>
			{#each checks as check (`${phase}-${check.label}`)}
				<li class={['check', check.ok ? 'ok' : check.advisory ? 'warning' : 'failing']}>
					<AnimatedIcon name={check.ok ? 'circle-check' : 'circle-alert'} size={16} />
					<div class="body">
						<span>
							{check.label}:
							{#if check.ok}
								met
							{:else}
								<strong>{check.advisory ? 'warning' : 'not met'}</strong>{check.detail
									? `, ${check.detail}`
									: ''}
							{/if}
						</span>
						{#if items[check.label]?.length}
							{@const list = items[check.label]}
							<ul class="items" aria-label="{check.label}, details">
								{#each list.slice(0, MAX_ITEMS) as item (item.key)}
									<li>
										{#if item.path && onopenfile}
											{@const path = item.path}
											<button
												type="button"
												class="item aise-hit"
												onclick={() => onopenfile({ path, line: item.line })}
											>
												<span class="where">{item.text}</span>
												<span class="what">{item.detail}</span>
											</button>
										{:else}
											<span class="item">
												<span class="where">{item.text}</span>
												<span class="what">{item.detail}</span>
											</span>
										{/if}
										{#if item.log}
											<pre class="log" aria-label="Log of {item.text}">{item.log}</pre>
										{/if}
									</li>
								{/each}
								{#if list.length > MAX_ITEMS}
									<li class="what">and {list.length - MAX_ITEMS} more</li>
								{/if}
							</ul>
						{/if}
					</div>
				</li>
			{/each}
		</ul>

		{#if phase === 'P4' && snapshot.canOpenDriftTicket}
			<div class="drift">
				<p class="note">
					The code differs from the design. A drift ticket plans the fix in either direction.
				</p>
				<form method="POST" action="?/openDriftTicket" use:enhance={openDrift}>
					<Button type="submit" size="sm" loading={running || busy === 'drift'}>
						<Icon icon={Ticket} size={16} />Open drift ticket
					</Button>
				</form>
			</div>
		{/if}

		{#if lastRun?.summary}
			<p class="summary"><span class="who">Summary of the last run</span> {lastRun.summary}</p>
		{/if}

		{#if blocked && failing.length > 0}
			<p class="blocked" role="status">
				Approve is blocked until these pass: {failing.map(label).join(', ')}.
			</p>
		{/if}

		{#if phase === 'P4' && !p2Approved}
			<p class="note">Approve the design first. The code is made from the approved design.</p>
		{:else if phase === 'P5' && !p4Approved}
			<p class="note">
				Approve the code first. The tests are made from the approved code and design.
			</p>
		{:else if phase === 'P6' && !p5Approved}
			<p class="note">
				Approve the tests first. The deployment is made from the approved code and design.
			</p>
		{/if}

		{#if status.status === 'stale'}
			<p class="note">
				The {CHANGED[phase as 'P2' | 'P4' | 'P5' | 'P6']} changed after approval.
				{upstreamApproved
					? 'Choose Update or Still valid in the banner above.'
					: `Approve the ${UPSTREAM[phase as 'P2' | 'P4' | 'P5' | 'P6']} first, then choose Update or Still valid.`}
			</p>
		{:else if status.status !== 'approved'}
			{#if running}
				<p class="note" role="status">The agent is working. You can approve when it finishes.</p>
			{/if}
			<Cluster gap={2}>
				<form method="POST" action="?/approve" use:enhance={approve}>
					<input type="hidden" name="phase" value={phase} />
					<Button type="submit" variant="primary" loading={running || busy === 'approve'}
						><Icon icon={Check} size={16} />Approve</Button
					>
				</form>
				{#if canAnyway}
					<form method="POST" action="?/approve" use:enhance={run('anyway')}>
						<input type="hidden" name="phase" value={phase} />
						<input type="hidden" name="anyway" value="true" />
						<Button type="submit" loading={running || busy === 'anyway'}>Approve anyway</Button>
					</form>
				{/if}
				{#if canOverride}
					<form method="POST" action="?/approve" use:enhance={run('override')}>
						<input type="hidden" name="phase" value={phase} />
						<input type="hidden" name="override" value="true" />
						<Button type="submit" loading={running || busy === 'override'}
							>Approve with override</Button
						>
					</form>
				{/if}
			</Cluster>
			{#if canAnyway}
				<p class="note">Approve anyway turns the open questions into assumptions.</p>
			{:else if canOverride}
				<p class="note">Approve with override records the failing checks with the approval.</p>
			{/if}
		{/if}

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

<Modal bind:open={discardOpen} title="Discard the last run?">
	<p>
		Discard run puts the files this run changed back as they were before it started ({phase}, {AGENT[
			phase
		]} agent). The chat messages and the cost of the run stay.
	</p>
	{#snippet footer()}
		<form method="POST" action="?/discard" use:enhance={run('discard')}>
			<Button type="submit" variant="destructive" loading={busy === 'discard'}>Discard run</Button>
		</form>
		<Button variant="primary" onclick={() => (discardOpen = false)}>Keep run</Button>
	{/snippet}
</Modal>

<style>
	.checks {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.check {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		font-size: var(--text-sm);
	}

	.check :global(.icon) {
		flex: none;
		margin-top: var(--space-1);
	}

	.check.ok :global(.icon) {
		color: var(--color-success);
	}

	.check.failing :global(.icon) {
		color: var(--color-error);
	}

	.check.warning :global(.icon) {
		color: var(--color-warning);
	}

	.body {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		min-width: 0;
	}

	.items {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: var(--text-xs);
	}

	.item {
		display: flex;
		box-sizing: border-box;
		width: 100%;
		flex-wrap: wrap;
		gap: 0 var(--space-2);
		margin: 0;
		padding: var(--space-1) var(--space-2);
		border: 0;
		border-radius: var(--radius-sm);
		background: var(--color-surface-2);
		color: var(--color-text);
		font: inherit;
		text-align: left;
	}

	button.item {
		border: 1px solid var(--color-border);
		cursor: pointer;
		transition: background-color var(--duration-100) var(--ease-out);
	}

	button.item:hover {
		background: var(--color-border);
	}

	.where {
		font-family: var(--font-mono);
	}

	.what {
		color: var(--color-text-muted);
		overflow-wrap: anywhere;
	}

	.log {
		max-height: 12rem;
		margin: var(--space-1) 0 0;
		padding: var(--space-1) var(--space-2);
		overflow: auto;
		border-radius: var(--radius-sm);
		background: var(--color-surface-2);
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.note,
	.summary {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}

	.who {
		font-weight: var(--weight-semibold);
	}

	.drift {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
	}

	.blocked {
		color: var(--color-error);
		font-size: var(--text-sm);
	}
</style>
