<script lang="ts">
	import Lightbulb from '@lucide/svelte/icons/lightbulb';
	import Network from '@lucide/svelte/icons/network';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '$app/forms';
	import { createFormError, type FormResult } from '#lib/form-error.svelte.ts';
	import type { PhaseStatus } from '#lib/server/core/state.ts';
	import type { DesignProposals, Proposal } from '#lib/server/core/tools/proposals.ts';
	import { Badge, Banner, Button, Disclosure, EmptyState, Panel, Stack } from '#lib/ui/index.ts';

	type Props = {
		/** The stored review; null before the first one. */
		proposals: DesignProposals | null;
		/** The P3 status: stale when the design changed after the review. */
		status: PhaseStatus;
		hasDesign: boolean;
		/** An agent run is active; the buttons wait for it. */
		running: boolean;
		/** Discuss: the page opens the design chat with the proposal in the composer. */
		ondiscuss: (proposal: Proposal) => void;
		/** Accept started the design run: the page shows it. */
		onaccepted?: () => void;
		form?: FormResult;
	};

	let {
		proposals,
		status,
		hasDesign,
		running,
		ondiscuss,
		onaccepted,
		form = null
	}: Props = $props();

	const KIND: Record<Proposal['kind'], string> = {
		missing_class: 'Missing class',
		missing_method: 'Missing method',
		unclear_responsibility: 'Unclear responsibility',
		uncovered_criterion: 'Uncovered criterion',
		sequence_mismatch: 'Sequence mismatch'
	};

	const uid = $props.id();
	const open = $derived(proposals?.proposals.filter((p) => p.status === 'open') ?? []);
	const resolved = $derived(proposals?.proposals.filter((p) => p.status !== 'open') ?? []);

	const error = createFormError(() => form, ['reviewDesign', 'acceptProposal', 'rejectProposal']);
	/** The form submitted (`action` or `action:id`), until the server answers. */
	let busy = $state<string>();

	const submit =
		(key: string, done?: () => void): SubmitFunction =>
		() => {
			busy = key;
			return async ({ result, update }) => {
				await update({ reset: false });
				busy = undefined;
				if (result.type === 'success') done?.();
			};
		};
	const wait = (key: string) => running || busy === key;

	let body: HTMLElement | undefined = $state();
	/** After Reject removes a card the focused button is gone: focus moves to the panel heading. */
	function focusHeading() {
		const heading = body?.closest('section')?.querySelector('h2');
		heading?.setAttribute('tabindex', '-1');
		heading?.focus();
	}
	const waitNote = $derived(running ? `${uid}-wait` : undefined);
</script>

{#snippet proposalForm(name: string, id: string, label: string, variant: 'primary' | 'secondary')}
	{@const key = `${name}:${id}`}
	<form
		method="POST"
		action="?/{name}"
		use:enhance={submit(key, name === 'acceptProposal' ? onaccepted : focusHeading)}
	>
		<input type="hidden" name="proposalId" value={id} />
		<Button
			type="submit"
			{variant}
			size="sm"
			loading={wait(key)}
			aria-label="{label} {id}"
			aria-describedby={waitNote}>{label}</Button
		>
	</form>
{/snippet}

<Panel title="Design review">
	{#snippet actions()}
		{#if hasDesign}
			<form method="POST" action="?/reviewDesign" use:enhance={submit('reviewDesign')}>
				<Button type="submit" size="sm" loading={wait('reviewDesign')} aria-describedby={waitNote}
					>Review design</Button
				>
			</form>
		{/if}
	{/snippet}
	<div bind:this={body}>
		<Stack gap={3}>
			{#if !hasDesign}
				<EmptyState
					icon={Network}
					title="No design yet"
					text="The review agent proposes improvements once the design agent has drawn the diagrams."
				/>
			{:else}
				{#if status === 'stale'}
					<Banner tone="warning" title="Out of date">
						The design changed since this review. Press Review design for current proposals.
					</Banner>
				{/if}
				{#if running}
					<p class="note" id="{uid}-wait">Available when the agent finishes.</p>
				{/if}
				{#if error.message}
					<Banner tone="error" title="That did not work">
						{error.message}
						{#snippet actions()}
							<Button size="sm" variant="ghost" onclick={error.dismiss}>Dismiss</Button>
						{/snippet}
					</Banner>
				{/if}
				{#if proposals === null}
					<EmptyState
						icon={Lightbulb}
						title="No review yet"
						text="The review agent checks the design against the requirements and proposes concrete improvements. It runs after every design change, or press Review design."
					/>
				{:else if open.length > 0}
					<ul class="cards">
						{#each open as p (p.id)}
							<li>
								<article class="card" aria-label="{p.id}, {p.title}">
									<header class="top">
										<Badge tone="info">{KIND[p.kind]}</Badge>
										<span class="id">{p.id}</span>
									</header>
									<h3>{p.title}</h3>
									<p class="text">{p.change}</p>
									{#if p.elementIds.length > 0 || p.reqIds.length > 0}
										<p class="ids">
											{#each new Set([...p.elementIds, ...p.reqIds]) as id (id)}<Badge>{id}</Badge
												>{/each}
										</p>
									{/if}
									<div class="buttons">
										{@render proposalForm('acceptProposal', p.id, 'Accept', 'primary')}
										{@render proposalForm('rejectProposal', p.id, 'Reject', 'secondary')}
										<Button
											size="sm"
											variant="ghost"
											aria-label="Discuss {p.id}"
											onclick={() => ondiscuss(p)}>Discuss</Button
										>
									</div>
								</article>
							</li>
						{/each}
					</ul>
				{:else if status !== 'stale'}
					<EmptyState
						icon={Lightbulb}
						title={resolved.length === 0 ? 'No improvements proposed' : 'No open proposals'}
						text="Code generation still starts from the approved design."
					/>
				{/if}
				{#if resolved.length > 0}
					<Disclosure summary="Resolved proposals ({resolved.length})">
						<ul class="resolved">
							{#each resolved as p (p.id)}
								<li>
									<span class="id">{p.id}</span>
									{p.title}
									<Badge tone={p.status === 'accepted' ? 'active' : 'default'}>{p.status}</Badge>
								</li>
							{/each}
						</ul>
					</Disclosure>
				{/if}
			{/if}
		</Stack>
	</div>
</Panel>

<style>
	ul {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.card {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
	}

	.top,
	.ids,
	.buttons {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-1) var(--space-2);
		margin: 0;
	}

	h3 {
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		font-weight: var(--weight-semibold);
		letter-spacing: 0;
	}

	.text {
		margin: 0;
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}

	.id {
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}

	.note {
		margin: 0;
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}

	.resolved {
		gap: var(--space-1);
		font-size: var(--text-sm);
	}
</style>
