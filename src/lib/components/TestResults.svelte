<script lang="ts">
	import type { DesignDoc } from '#lib/server/core/schemas/design.ts';
	import type { Requirement } from '#lib/server/core/schemas/requirements.ts';
	import type { TestChecks } from '#lib/server/core/test-state.ts';
	import { groupTests, missingCriteria, type RowStatus } from '#lib/test-results.ts';
	import { Badge, Banner, Stack } from '#lib/ui/index.ts';

	type Props = {
		checks: TestChecks;
		reqs: Requirement[];
		design: DesignDoc | null;
		/** A test row was clicked: show its file at its line. */
		onOpen: (path: string, line?: number) => void;
	};

	let { checks, reqs, design, onOpen }: Props = $props();

	const TONE = {
		passed: 'active',
		failed: 'error',
		manual: 'info',
		skipped: 'default',
		todo: 'default'
	} as const;
	const WORD: Record<RowStatus, string> = {
		passed: 'passed',
		failed: 'failed',
		manual: 'manual',
		skipped: 'skipped',
		todo: 'not written'
	};

	const uid = $props.id();
	const result = $derived(checks.result);
	const groups = $derived(groupTests(result?.tests ?? [], design));
	const missing = $derived(missingCriteria(reqs, result?.tests ?? []));
	const count = (rows: { status: RowStatus }[]) => rows.filter((r) => r.status === 'passed').length;
</script>

<Stack gap={4}>
	{#if result === null}
		<p class="note">The tests did not run: the project has no package.json yet.</p>
	{:else}
		{#if result.timedOut}
			<Banner tone="error" title="The test run timed out">
				The results below are what finished. Run the tests again, or ask the test agent to simplify
				the slow test.
			</Banner>
		{:else if result.noTests}
			<Banner tone="warning" title="No test ran">
				The suite exited without a passed or failed test. Check that the test files contain tests.
			</Banner>
		{/if}

		{#each groups as group, i (group.key)}
			<div class="group" role="group" aria-labelledby="{uid}-{i}">
				<header class="head">
					<h3 id="{uid}-{i}">{group.heading}</h3>
					<span class="count aise-num">{count(group.rows)} of {group.rows.length} passed</span>
				</header>
				<ul class="rows">
					{#each group.rows as row (row.key)}
						<li>
							<!-- The name carries the group, so two tests with the same title stay apart. -->
							<button
								type="button"
								class="row aise-hit"
								aria-label={[WORD[row.status], row.label, row.text, `in ${group.heading}`]
									.filter(Boolean)
									.join(' ')}
								onclick={() => onOpen(row.file, row.line)}
							>
								<Badge tone={TONE[row.status]}>{WORD[row.status]}</Badge>
								<span class="what">
									{#if row.label}<span class="label">{row.label}</span>{/if}
									<span class="text">{row.text}</span>
									{#if row.error}<span class="error">{row.error}</span>{/if}
								</span>
							</button>
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	{/if}

	{#if missing.length > 0}
		<section class="missing">
			<h3 id="{uid}-missing">Criteria without a test</h3>
			<ul aria-labelledby="{uid}-missing">
				{#each missing as m (`${m.reqId}-${m.n}`)}
					<li>
						<Badge tone={m.priority === 'must' ? 'error' : 'pending'}>{m.priority}</Badge>
						<span class="label">{m.reqId} AC{m.n}</span>
						<span class="text">{m.text}</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}
</Stack>

<style>
	.note {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}

	.group {
		border: 1px solid var(--color-border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
		padding: var(--space-2) var(--space-3);
		background: var(--color-surface-2);
		border-bottom: 1px solid var(--color-border);
	}

	h3 {
		font-family: var(--font-sans);
		font-size: var(--text-sm);
		font-weight: var(--weight-semibold);
		letter-spacing: 0;
		overflow-wrap: anywhere;
	}

	.count {
		flex: none;
		color: var(--color-text-muted);
		font-size: var(--text-xs);
	}

	ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.rows li + li {
		border-top: 1px solid var(--color-border);
	}

	.row {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
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

	.what {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		min-width: 0;
	}

	.label {
		color: var(--color-text-muted);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
	}

	.text {
		overflow-wrap: anywhere;
	}

	.error {
		color: var(--color-error);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		overflow-wrap: anywhere;
	}

	.missing {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.missing li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-2);
		padding: var(--space-1) 0;
		font-size: var(--text-sm);
	}
</style>
