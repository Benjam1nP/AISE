<script lang="ts">
	import FilePlus from '@lucide/svelte/icons/file-plus';
	import Ticket from '@lucide/svelte/icons/ticket';
	import { tick, untrack } from 'svelte';
	import type { FormResult } from '#lib/form-error.svelte.ts';
	import type { ProjectSnapshot } from '#lib/server/index.ts';
	import { selectedTicketId } from '#lib/workspace-view.ts';
	import { Badge, Button, Cluster, EmptyState, Icon, Stack } from '#lib/ui/index.ts';
	import { KIND_LABEL, STATUS_LABEL, STATUS_TONE } from './ticket-labels.ts';
	import TicketDetail from './TicketDetail.svelte';
	import TicketForm from './TicketForm.svelte';

	type Props = {
		snapshot: ProjectSnapshot;
		form: FormResult;
		/** The ticket shown; the page reads it for the ticket chat. Reports the default and every choice. */
		selectedId?: string;
		/** An affected ID was clicked (REQ, UC, SEQ, DSN). */
		onopenid: (id: string) => void;
		/** A file was clicked. */
		onopenfile: (open: { path: string }) => void;
		/** The developer should review this phase. */
		onselectphase: (phase: string) => void;
		/** The New ticket form is open; the page keeps it, so it stays open while another tab shows. */
		creating?: boolean;
		/** The new ticket's description; the page keeps it for IDs clicked in a diagram. */
		draft?: string;
	};

	let {
		snapshot,
		form,
		selectedId = $bindable(),
		onopenid,
		onopenfile,
		onselectphase,
		creating = $bindable(false),
		draft = $bindable('')
	}: Props = $props();

	const tickets = $derived(snapshot.tickets);
	// Opens on the ticket the page already shows, so a choice survives another tab; the default is
	// not a choice and stays open to a ticket that goes in progress.
	let chosen = $state<string | undefined>(
		untrack(() =>
			selectedId === selectedTicketId(snapshot.tickets, undefined, snapshot.tickets.length)
				? undefined
				: selectedId
		)
	);
	let ticketForm: ReturnType<typeof TicketForm> | undefined = $state();
	/** The button that opened the form, so focus can go back to it. */
	let opener: HTMLElement | undefined;

	/** How many tickets there were when the developer last chose one; more than that means a new one. */
	let seen = $state(untrack(() => snapshot.tickets.length));
	const choose = (id: string) => {
		chosen = id;
		seen = tickets.length;
	};

	async function toggleForm(event: MouseEvent & { currentTarget: HTMLElement }) {
		opener = event.currentTarget;
		creating = !creating;
		// Cancel drops what was written; the page keeps the draft only while the form is open.
		if (!creating) draft = '';
		await tick();
		// Cancel keeps focus on the same button; opening moves it into the form.
		if (creating) ticketForm?.focus();
	}

	async function created() {
		creating = false;
		await tick();
		opener?.focus();
	}

	// A ticket that appears (created here, or opened from the Code tab) is the one to look at; else the
	// developer's choice, the ticket in progress (it needs them most), or the newest.
	const selected = $derived(tickets.find((t) => t.id === selectedTicketId(tickets, chosen, seen)));
	$effect(() => {
		if (selectedId !== selected?.id) selectedId = selected?.id;
	});
	const formOpen = $derived(creating || tickets.length === 0);
</script>

<Stack gap={4}>
	{#if tickets.length > 0}
		<Cluster justify="end">
			<Button size="sm" variant={creating ? 'ghost' : 'primary'} onclick={toggleForm}>
				{#if creating}Cancel{:else}<Icon icon={FilePlus} size={16} />New ticket{/if}
			</Button>
		</Cluster>
	{/if}

	{#if formOpen}
		<section class="new" aria-label="New ticket">
			{#if tickets.length === 0}
				<EmptyState
					icon={Ticket}
					title="No tickets yet"
					text="Every change after approval goes through a ticket. Describe the change and the maintenance agent plans it."
				/>
			{/if}
			<TicketForm
				bind:this={ticketForm}
				{form}
				running={snapshot.activeRun !== null}
				ondone={created}
				bind:description={draft}
			/>
		</section>
	{/if}

	{#if tickets.length > 0}
		<ul class="list" aria-label="Tickets">
			{#each tickets as t (t.id)}
				<li>
					<button
						type="button"
						class="row aise-hit"
						aria-current={t.id === selected?.id ? 'true' : undefined}
						onclick={() => choose(t.id)}
					>
						<span class="id">{t.id}</span>
						<span class="kind">{KIND_LABEL[t.kind]}</span>
						<span class="name">{t.title}</span>
						<Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
					</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if selected}
		{#key selected.id}
			<TicketDetail {snapshot} ticket={selected} {form} {onopenid} {onopenfile} {onselectphase} />
		{/key}
	{/if}
</Stack>

<style>
	.new {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		padding: var(--space-4);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
	}

	.list {
		margin: 0;
		padding: 0;
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		list-style: none;
		overflow: hidden;
	}

	.list li + li {
		border-top: 1px solid var(--color-border);
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1) var(--space-3);
		box-sizing: border-box;
		width: 100%;
		margin: 0;
		padding: var(--space-2) var(--space-3);
		border: 0;
		background: transparent;
		color: var(--color-text);
		font: inherit;
		font-size: var(--text-sm);
		text-align: left;
		cursor: pointer;
		transition: background-color var(--duration-100) var(--ease-out);
	}

	.row:hover {
		background: var(--color-surface-2);
	}

	.row[aria-current='true'] {
		background: var(--color-surface-2);
		box-shadow: inset 0 0 0 1px var(--color-border);
	}

	.id {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}

	.kind {
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}

	.name {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
</style>
