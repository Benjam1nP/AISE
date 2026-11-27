<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '$app/forms';
	import { createFormError, type FormResult } from '#lib/form-error.svelte.ts';
	import type { GateResult } from '#lib/server/index.ts';
	import { Badge, Banner, Button, Cluster } from '#lib/ui/index.ts';

	type Props = {
		/** What is stale: the design (after a requirements change), the code (after a design change), the tests or the deployment. */
		phase?: 'P2' | 'P4' | 'P5' | 'P6';
		/** IDs that changed since approval: requirement IDs for P2, design element IDs for P4, REQ, UC and SEQ IDs for P5, service node IDs (and `dependencies`, `code`) for P6. */
		ids: string[];
		/** The checks of the phase gate that fail right now. */
		failing: GateResult['checks'];
		running: boolean;
		/** The phase this one is made from is approved (P5: the code, P6: the tests); Update and Still valid need that. */
		upstreamApproved: boolean;
		/** Takes the developer to the approval of the phase this one is made from. */
		onshowupstream: () => void;
		form: FormResult;
	};

	let {
		phase = 'P2',
		ids,
		failing,
		running,
		upstreamApproved,
		onshowupstream,
		form
	}: Props = $props();

	/** Advisory checks never block, so Still valid records no override for them. */
	const blocking = $derived(failing.filter((c) => !c.ok && !c.advisory));

	// `changed` is what the developer edited; `upstream` is the approval Update and Still valid wait for.
	const WORDS = {
		P2: {
			changed: 'requirements',
			upstream: 'requirements',
			made: 'design',
			update: 'Update design',
			agent: 'design'
		},
		P4: {
			changed: 'design',
			upstream: 'design',
			made: 'code',
			update: 'Update code',
			agent: 'code'
		},
		P5: {
			changed: 'requirements or design',
			upstream: 'code',
			made: 'tests',
			update: 'Update tests',
			agent: 'test'
		},
		P6: {
			changed: 'services, start scripts, dependencies or code',
			upstream: 'tests',
			made: 'deployment',
			update: 'Update deployment',
			agent: 'deploy'
		}
	} as const;
	const words = $derived(WORDS[phase]);

	const error = createFormError(() => form, ['update', 'stillValid']);
	let busy = $state<'update' | 'stillValid'>();

	const run =
		(key: 'update' | 'stillValid'): SubmitFunction =>
		() => {
			busy = key;
			return async ({ update }) => {
				await update({ reset: false });
				busy = undefined;
			};
		};
</script>

<Banner tone="warning" title="The {words.changed} changed after you approved the {words.made}">
	<Cluster gap={2}>
		<span>Changed:</span>
		{#each ids as id (id)}<Badge tone="pending">{id}</Badge>{/each}
	</Cluster>
	{#if !upstreamApproved}
		<p>
			<strong>Approve the {words.upstream} first, then choose Update or Still valid.</strong>
			Editing the {words.changed} reopened it for approval.
		</p>
	{/if}
	<p>
		Update asks the {words.agent} agent to adjust the affected {phase === 'P2'
			? 'elements'
			: 'files'}. Still valid keeps the {words.made} as it is.
	</p>
	{#if blocking.length > 0}
		<p>
			The {words.made} fails these checks right now: {blocking
				.map((c) => (c.detail ? `${c.label} (${c.detail})` : c.label))
				.join(', ')}. Still valid records this as an override.
		</p>
	{/if}
	{#snippet actions()}
		<form method="POST" action="?/update" use:enhance={run('update')}>
			<input type="hidden" name="phase" value={phase} />
			<Button type="submit" variant="primary" size="sm" loading={running || busy === 'update'}
				>{words.update}</Button
			>
		</form>
		<form method="POST" action="?/stillValid" use:enhance={run('stillValid')}>
			<input type="hidden" name="phase" value={phase} />
			<Button type="submit" size="sm" loading={busy === 'stillValid'}
				>{blocking.length > 0 ? 'Still valid, override' : 'Still valid'}</Button
			>
		</form>
	{/snippet}
</Banner>
{#if error.message}
	<Banner tone="error" title="That did not work">
		{error.message}
		{#snippet actions()}
			{#if !upstreamApproved}
				<Button size="sm" variant="primary" onclick={onshowupstream}
					>Go to {words.upstream} approval</Button
				>
			{/if}
			<Button size="sm" variant="ghost" onclick={error.dismiss}>Dismiss</Button>
		{/snippet}
	</Banner>
{/if}
