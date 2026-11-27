<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '$app/forms';
	import { createFormError, type FormResult } from '#lib/form-error.svelte.ts';
	import type { Finding, TestFix } from '#lib/server/core/test-state.ts';
	import type { RunTestsResult } from '#lib/server/core/tools/check.ts';
	import { findingOpen } from '#lib/test-names.ts';
	import { Badge, Banner, Button, Disclosure, Stack } from '#lib/ui/index.ts';

	type Props = {
		findings: Finding[];
		/** The stored test result: a finding is open while its test still fails in it. */
		result: RunTestsResult | null;
		/** Tests the triage corrected, with the reason. */
		testFixes?: TestFix[];
		/** No agent run is active; Apply fix starts one. */
		canApply: boolean;
		/** Why Apply fix is unavailable; the default is a running agent. */
		waitNote?: string;
		form?: FormResult;
	};

	let {
		findings,
		result,
		testFixes = [],
		canApply,
		waitNote = 'Apply fix is available when the agent finishes.',
		form = null
	}: Props = $props();

	const uid = $props.id();
	const open = $derived(findings.filter((f) => findingOpen(f, result)));
	/** Most recently resolved first; one without a time (only in checks written before resolvedAt existed) goes last. */
	const resolved = $derived(
		findings
			.filter((f) => !findingOpen(f, result))
			.sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? ''))
	);

	const error = createFormError(() => form, ['applyFix']);
	/** The finding whose Apply fix was submitted, until the server answers. */
	let busy = $state<string>();

	const apply =
		(id: string): SubmitFunction =>
		() => {
			busy = id;
			return async ({ update }) => {
				await update({ reset: false });
				busy = undefined;
			};
		};
</script>

{#if open.length > 0 || resolved.length > 0 || testFixes.length > 0}
	<Stack gap={3}>
		{#if open.length > 0}
			<section class="block">
				<h3>Code bugs found by the tests ({open.length})</h3>
				<ul class="findings">
					{#each open as f (f.id)}
						<li>
							<article class="finding" aria-label="{f.test}, {f.file}">
								<header class="top">
									<span class="test">{f.test}</span>
									{#if f.reqId}<Badge tone="info">{f.reqId}</Badge>{/if}
									<span class="file">{f.file}</span>
								</header>
								<p class="text">{f.explanation}</p>
								<p class="text">
									<span class="who">Proposed fix</span>
									{f.proposedFix}
								</p>
								<form method="POST" action="?/applyFix" use:enhance={apply(f.id)}>
									<input type="hidden" name="findingId" value={f.id} />
									<Button
										type="submit"
										variant="primary"
										size="sm"
										loading={!canApply || busy === f.id}
										aria-describedby={canApply ? undefined : `${uid}-wait`}>Apply fix</Button
									>
								</form>
							</article>
						</li>
					{/each}
				</ul>
				{#if !canApply}
					<p class="note" id="{uid}-wait">{waitNote}</p>
				{/if}
				{#if error.message}
					<Banner tone="error" title="That did not work">
						{error.message}
						{#snippet actions()}
							<Button size="sm" variant="ghost" onclick={error.dismiss}>Dismiss</Button>
						{/snippet}
					</Banner>
				{/if}
			</section>
		{/if}

		{#if testFixes.length > 0}
			<section class="block">
				<h3 id="{uid}-fixes">Tests corrected ({testFixes.length})</h3>
				<ul class="fixes" aria-labelledby="{uid}-fixes">
					{#each testFixes as fix (`${fix.runId}-${fix.file}-${fix.test}`)}
						<li class="fix">
							<Badge tone="pending">test corrected</Badge>
							<span class="test">{fix.test}</span>
							<span class="file">{fix.file}</span>
							<p class="text">{fix.reason}</p>
						</li>
					{/each}
				</ul>
			</section>
		{/if}

		{#if resolved.length > 0}
			<Disclosure summary="Resolved findings ({resolved.length})">
				<ul class="resolved">
					{#each resolved as f (f.id)}
						<li><span class="test">{f.test}</span> <span class="file">{f.file}</span></li>
					{/each}
				</ul>
			</Disclosure>
		{/if}
	</Stack>
{/if}

<style>
	.block {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	h3 {
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		font-weight: var(--weight-semibold);
		letter-spacing: 0;
	}

	ul {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.finding,
	.fix {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-3);
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		background: var(--color-surface);
	}

	.fix {
		flex-flow: row wrap;
		align-items: baseline;
	}

	.top {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1) var(--space-2);
	}

	.test {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		overflow-wrap: anywhere;
	}

	.file {
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		overflow-wrap: anywhere;
	}

	.text {
		margin: 0;
		font-size: var(--text-sm);
		overflow-wrap: anywhere;
	}

	.fix .text {
		flex-basis: 100%;
		color: var(--color-text-muted);
	}

	.who {
		font-weight: var(--weight-semibold);
	}

	.note {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}

	.resolved {
		gap: var(--space-1);
	}
</style>
