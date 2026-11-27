<script lang="ts">
	import { hasCodeFiles, hasDeployFiles, hasTestFiles } from '#lib/code-files.ts';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import SendHorizontal from '@lucide/svelte/icons/send-horizontal';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '$app/forms';
	import { tick, untrack } from 'svelte';
	import { FIX_LOOP_BROKEN_CODE, FIX_LOOP_BROKEN_TESTS } from '#lib/fix-loop-errors.ts';
	import { createFormError } from '#lib/form-error.svelte.ts';
	import { agentLabel, failureReason, orbMood, type LiveRun } from '#lib/live-run.ts';
	import type { AgentRole } from '#lib/server/core/chat.ts';
	import type { ProjectSnapshot } from '#lib/server/index.ts';
	import { Banner, Button, EmptyState, Icon, Panel, Textarea, ThinkingOrb } from '#lib/ui/index.ts';
	import ChatMarkdown from './ChatMarkdown.svelte';
	import { ENTRY_LINE } from './ticket-labels.ts';
	import ToolCall from './ToolCall.svelte';

	type TicketView = ProjectSnapshot['tickets'][number];
	type Props = {
		snapshot: ProjectSnapshot;
		/** The phase chat. Omit it when `ticket` is set. */
		phase?: 'P1' | 'P2' | 'P4' | 'P5' | 'P6';
		/** Ticket mode: the chat of this ticket with the maintenance agent instead of a phase chat. */
		ticket?: TicketView;
		live: LiveRun | null;
		/** The result of the last form action of the page. */
		form: { action?: string; message?: string } | null | undefined;
	};

	let { snapshot, phase, ticket, live, form }: Props = $props();

	const AGENT = { P1: 'requirements', P2: 'design', P4: 'code', P5: 'test', P6: 'deploy' } as const;
	const agent = $derived(ticket ? 'maintenance' : phase ? AGENT[phase] : 'requirements');
	/** A done or rejected ticket takes no more messages. */
	const closed = $derived(ticket?.status === 'done' || ticket?.status === 'rejected');
	const action = $derived(ticket ? 'ticketSend' : 'send');

	const entries = $derived(ticket ? ticket.chat : phase ? snapshot.chat[phase] : []);
	const discarded = $derived(new Set(snapshot.discardedRunIds));
	const activeRun = $derived(snapshot.activeRun);
	const running = $derived(activeRun !== null);
	// A ticket chat shows the live text of the ticket's own P7 runs; its phase runs show in the phase chat.
	const runHere = $derived(
		ticket
			? activeRun?.phase === 'P7' && activeRun.ticketId === ticket.id
			: activeRun?.phase === phase
	);
	const liveAll = $derived(
		live && activeRun && runHere && live.runId === activeRun.runId ? live.items : []
	);
	// A reloaded snapshot chat already holds handoffs the live items repeat: a live message whose
	// position in the run matches a stored handoff of the active run shows only once.
	const liveItems = $derived.by(() => {
		const stored = new Set(
			entries.filter((e) => e.runId === activeRun?.runId && e.seq).map((e) => e.seq)
		);
		// Each item keeps its position in the run as its key, so a dropped duplicate re-keys nothing.
		return liveAll
			.map((item, at) => ({ item, at }))
			.filter(({ item }) => item.kind !== 'message' || !stored.has(item.seq));
	});
	const lastRun = $derived(
		(
			ticket
				? snapshot.lastRun?.phase === 'P7' && snapshot.lastRun.ticketId === ticket.id
				: snapshot.lastRun?.phase === phase
		)
			? snapshot.lastRun
			: null
	);
	const failedRun = $derived(!running && lastRun?.status === 'failed' ? lastRun : null);
	const lastUser = $derived(entries.findLast((e) => e.role === 'user'));
	const lastUserText = $derived(lastUser?.text ?? '');
	// Retry would resend only the plain line of an entry run, without the plan: the ticket restarts it.
	const entryFailed = $derived(
		!ticket && lastUser?.auto === true && ENTRY_LINE.test(lastUser.text)
	);
	// After a discard the ticket is triaged again and starts with Approve plan.
	const entryTriaged = $derived(
		entryFailed &&
			snapshot.tickets.find((t) => t.id === lastUser?.text.match(/TCK-\d+/)?.[0])?.status ===
				'triaged'
	);
	// Fix automatically, Apply fix and Explain failures give the agent a brief the chat line leaves
	// out: sending the line again would start a plain test agent chat run. The Tests tab starts them.
	// The Explain failures line is the one triageTests writes in the orchestrator.
	// A loop that left typecheck errors or drift may have green tests, so Fix automatically is hidden:
	// the Code tab and the P4 gate show what to repair. A loop that left test files that no longer
	// load needs the test agent or the developer, never the loop again.
	const leftBroken = $derived(
		failedRun?.fixLoop === true && failedRun.error === FIX_LOOP_BROKEN_CODE
	);
	const leftBrokenTests = $derived(
		failedRun?.fixLoop === true && failedRun.error === FIX_LOOP_BROKEN_TESTS
	);
	const testsTabButton = $derived.by(() => {
		if (phase !== 'P5' || !failedRun || ticket) return null;
		if (failedRun.fixLoop === true && !leftBroken && !leftBrokenTests) return 'Fix automatically';
		if (failedRun.agent === 'code') return 'Apply fix';
		if (lastUser?.auto === true && lastUser.text === 'Explain the failing tests.')
			return 'Explain failures';
		return null;
	});
	// A failed close run starts again with Close ticket, which sends the report data.
	const reportFailed = $derived(ticket !== undefined && failedRun?.report === true);
	const p1Open = $derived(phase === 'P2' && snapshot.state.phases.P1.status !== 'approved');
	const p2Open = $derived(phase === 'P4' && snapshot.state.phases.P2.status !== 'approved');
	const p4Open = $derived(phase === 'P5' && snapshot.state.phases.P4.status !== 'approved');
	const p5Open = $derived(phase === 'P6' && snapshot.state.phases.P5.status !== 'approved');
	const noCode = $derived(!hasCodeFiles(snapshot.files));
	const noTests = $derived(!hasTestFiles(snapshot.files));
	const noDeploy = $derived(!hasDeployFiles(snapshot.files));

	const START_TITLE = {
		P1: 'Describe your idea',
		P2: 'Start the design',
		P4: 'Review the code',
		P5: 'Review the tests',
		P6: 'Review the deployment'
	} as const;
	const startTitle = $derived(ticket ? 'Talk about this ticket' : START_TITLE[phase ?? 'P1']);
	/** What the empty chat tells the developer: the missing approval or artefact first, else what to ask. */
	const emptyText = $derived.by(() => {
		if (ticket) {
			return ticket.status === 'open'
				? 'The maintenance agent asks questions here. Answer its questions to get a plan.'
				: 'Ask the maintenance agent about the plan or the impact of this ticket, or ask for a new plan.';
		}
		if (p1Open) return 'Approve the requirements first. Then ask for the design here.';
		if (p2Open) return 'Approve the design first. Then generate the code and ask for changes here.';
		if (p4Open) return 'Approve the code first. Then generate the tests and ask for changes here.';
		if (p5Open) {
			return 'Approve the tests first. Then generate the deployment and ask for changes here.';
		}
		if (phase === 'P4' && noCode) {
			return 'Generate the code first. Then ask the code agent for changes here.';
		}
		if (phase === 'P5' && noTests) {
			return 'Generate the tests first. Then ask the test agent for changes here.';
		}
		if (phase === 'P6' && noDeploy) {
			return 'Generate the deployment first. Then ask the deploy agent for changes here.';
		}
		return {
			P1: 'Tell the requirements agent what you want to build. It asks questions instead of guessing.',
			P2: 'Ask the design agent for changes, or ask why it modelled something the way it did.',
			P4: 'Ask the code agent for changes, for example to store the tasks in a Map.',
			P5: 'Ask the test agent for changes, for example to add a test for an edge case.',
			P6: 'Ask the deploy agent for changes, for example why a service uses port 8081 or to add a troubleshooting section to RUN.md.'
		}[phase ?? 'P1'];
	});

	// A ticket chat opens with the form of an earlier ticket in place: that error is not its own.
	const sendError = createFormError(
		() => form,
		() => [action],
		untrack(() => ticket !== undefined)
	);

	let draft = $state('');
	const empty = $derived(draft.trim() === '');
	let sending = $state(false);
	let retrying = $state(false);
	let composer: HTMLFormElement | undefined = $state();

	const textarea = () => composer?.querySelector('textarea');

	/** Adds text (for example an element ID from a diagram) to the message being written. */
	export function insert(text: string): void {
		const gap = draft === '' || /\s$/.test(draft) ? '' : ' ';
		draft = `${draft}${gap}${text}`;
		textarea()?.focus();
	}

	const sendMessage: SubmitFunction = ({ cancel }) => {
		// An empty message is not sent; focus goes back to the box (R17: Send stays enabled).
		if (empty) {
			cancel();
			textarea()?.focus();
			return;
		}
		sending = true;
		return async ({ result, update }) => {
			await update({ reset: false });
			sending = false;
			if (result.type === 'success') draft = '';
		};
	};

	const retry: SubmitFunction = () => {
		retrying = true;
		return async ({ update }) => {
			await update({ reset: false });
			retrying = false;
		};
	};

	function sendOnShortcut(event: KeyboardEvent & { currentTarget: HTMLTextAreaElement }) {
		if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
		event.preventDefault();
		event.currentTarget.form?.requestSubmit();
	}

	// Keeps the newest message in view; reruns when messages arrive or the run state changes.
	function follow(node: HTMLElement) {
		void [entries.length, liveItems.length, running];
		void tick().then(() => (node.scrollTop = node.scrollHeight));
	}
</script>

{#snippet handoff(from: AgentRole, to: AgentRole, text: string, gone = false)}
	<article class={['message', 'handoff', { discarded: gone }]}>
		<p class="who">
			{agentLabel(from)}
			<span aria-hidden="true">→</span> <span class="aise-sr-only">to</span>
			{agentLabel(to)}
			{#if gone}<span> · run discarded, the agent no longer sees this</span>{/if}
		</p>
		<p class="text">{text}</p>
	</article>
{/snippet}

{#snippet retryAction()}
	<form method="POST" action="?/{action}" use:enhance={retry}>
		{#if ticket}
			<input type="hidden" name="ticketId" value={ticket.id} />
		{:else}
			<input type="hidden" name="phase" value={phase} />
		{/if}
		<input type="hidden" name="text" value={lastUserText} />
		<Button type="submit" size="sm" variant="primary" loading={retrying}>Retry</Button>
	</form>
{/snippet}

<Panel title="Chat with the {agent} agent">
	<div class="column">
		<div class="messages" role="log" aria-label="Conversation" {@attach follow}>
			{#if entries.length === 0 && liveItems.length === 0 && !runHere}
				<EmptyState icon={MessageSquare} title={startTitle} text={emptyText} />
			{/if}
			{#each entries as entry, i (`${entry.runId ?? ''}-${entry.role}-${i}`)}
				{@const gone = entry.runId !== undefined && discarded.has(entry.runId)}
				{#if entry.from && entry.to}
					{@render handoff(entry.from, entry.to, entry.text, gone)}
				{:else}
					<article class={['message', entry.role, { discarded: gone }]}>
						<p class="who">
							{entry.role === 'user' ? (entry.auto ? 'Automatic request' : 'You') : 'Agent'}
							{#if gone}<span> · run discarded, the agent no longer sees this</span>{/if}
						</p>
						{#if entry.role === 'user'}
							<p class="text">{entry.text}</p>
						{:else}
							<ChatMarkdown text={entry.text} />
						{/if}
					</article>
				{/if}
			{/each}
			{#each liveItems as { item, at } (at)}
				{#if item.kind === 'text'}
					<article class="message assistant">
						<p class="who">Agent</p>
						<ChatMarkdown text={item.text} />
					</article>
				{:else if item.kind === 'message'}
					{@render handoff(item.from, item.to, item.text)}
				{:else}
					<ToolCall
						name={item.name}
						input={item.input}
						result={item.result}
						isError={item.isError}
					/>
				{/if}
			{/each}
		</div>

		{#if running}
			<div class="working" role="status">
				<ThinkingOrb state={orbMood(liveAll)} size={20} />
				<span>The agent is working; you can send when it finishes.</span>
			</div>
		{/if}

		{#if failedRun}
			<Banner
				tone="error"
				title="The last run failed"
				actions={entryFailed || reportFailed || leftBroken || leftBrokenTests || testsTabButton
					? undefined
					: retryAction}
			>
				{failureReason(failedRun.error)}
				{#if entryTriaged}
					This was the entry run of a ticket, which is triaged again. Open the ticket in P7
					Maintenance and press Approve plan, so the agent gets the plan.
				{:else if entryFailed}
					This was the entry run of a ticket. Open the ticket in P7 Maintenance and press Start the
					entry run again, so the agent gets the plan.
				{:else if reportFailed}
					Press Close ticket again to write the change report.
				{:else if leftBroken}
					Open the Code tab and the P4 gate to see the typecheck errors and drift, then repair them
					there or with the code chat.
				{:else if leftBrokenTests}
					Check them in the Tests tab or the P5 chat.
				{:else if testsTabButton}
					Press {testsTabButton} in the Tests tab to start it again.
				{:else}
					Retry sends your last message again.
				{/if}
				{#if !ticket}
					To put the files back as they were before the run, use Discard last run in the approval
					panel.
				{/if}
			</Banner>
		{/if}

		{#if sendError.message}
			<Banner tone="error" title="That did not work">
				{sendError.message}
				{#snippet actions()}
					<Button size="sm" variant="ghost" onclick={sendError.dismiss}>Dismiss</Button>
				{/snippet}
			</Banner>
		{/if}

		{#if closed}
			<p class="note">This ticket is closed. Open a new ticket for further changes.</p>
		{:else}
			<form
				method="POST"
				action="?/{action}"
				class="composer"
				bind:this={composer}
				use:enhance={sendMessage}
			>
				{#if ticket}
					<input type="hidden" name="ticketId" value={ticket.id} />
				{:else}
					<input type="hidden" name="phase" value={phase} />
				{/if}
				<Textarea
					name="text"
					label="Message to the {agent} agent"
					rows={3}
					bind:value={draft}
					onkeydown={sendOnShortcut}
				/>
				<div class="send">
					<Button
						type="submit"
						variant="primary"
						loading={running || sending}
						title="Send (Ctrl or Cmd and Enter)"
						aria-keyshortcuts="Control+Enter Meta+Enter"
						><Icon icon={SendHorizontal} size={16} />Send</Button
					>
				</div>
			</form>
		{/if}
	</div>
</Panel>

<style>
	.column {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		height: 100%;
	}

	.messages {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding-right: var(--space-1);
		min-height: calc(var(--space-16) * 3);
		max-height: 60dvh;
		overflow-y: auto;
	}

	/* Wide screens: Chat expects a fixed height parent (SplitView stickLeft) and fills it; the log takes the rest. */
	@media (min-width: 960px) {
		.messages {
			flex: 1;
			min-height: 0;
			max-height: none;
		}
	}

	.message {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		max-width: 92%;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-lg);
		border-top-left-radius: var(--radius-sm);
		background: var(--color-surface);
		animation: message-in var(--duration-300) var(--ease-out);
	}

	.message.user {
		align-self: flex-end;
		border-color: transparent;
		border-radius: var(--radius-lg);
		border-top-right-radius: var(--radius-sm);
		background: var(--color-surface-2);
	}

	@keyframes message-in {
		from {
			opacity: 0;
			transform: translateY(var(--space-1));
		}
	}

	.message.discarded {
		background: none;
		border: 1px dashed var(--color-border);
		color: var(--color-text-muted);
	}

	/* A handoff between agents is quiet: no bubble fill, a rule on the left, full width. */
	.message.handoff {
		align-self: stretch;
		max-width: none;
		border: none;
		border-left: 2px solid var(--color-border-strong);
		border-radius: var(--radius-sm);
		background: none;
		padding-block: var(--space-1);
		color: var(--color-text-muted);
	}

	.message.handoff.discarded {
		border-left-style: dashed;
	}

	.message.handoff .who {
		font-family: var(--font-mono);
	}

	.who {
		color: var(--color-text-muted);
		font-size: var(--text-xs);
		font-weight: var(--text-xs-weight);
	}

	.text {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.working {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}

	.note {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}

	.composer {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.send {
		display: flex;
		justify-content: flex-end;
	}
</style>
