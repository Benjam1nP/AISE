<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '$app/forms';
	import { hasTestFiles } from '#lib/code-files.ts';
	import { createFormError, type FormResult } from '#lib/form-error.svelte.ts';
	import type { FileStatus } from '#lib/server/codegen/generate.ts';
	import type { ProjectSnapshot } from '#lib/server/index.ts';
	import { findingOpen, unexplainedFailures } from '#lib/test-names.ts';
	import { describeTitle } from '#lib/test-results.ts';
	import { Badge, Banner, Button, Cluster, Stack } from '#lib/ui/index.ts';
	import CodegenProgress from './CodegenProgress.svelte';
	import CodePanel from './CodePanel.svelte';
	import Findings from './Findings.svelte';
	import TestResults from './TestResults.svelte';

	type Open = { path: string; line?: number };
	type Props = {
		snapshot: ProjectSnapshot;
		form: FormResult;
		/** The file states of the active test generation run, else null. */
		progress: Record<string, FileStatus> | null;
		/** A test file to show, and the line to mark in it. Pass a new object to open again. */
		open?: Open;
	};

	let { snapshot, form, progress, open }: Props = $props();

	const testFiles = $derived(snapshot.files.filter((f) => f.startsWith('test/')));
	/** CodePanel lists `snapshot.files`; here that is the tests only. */
	const testSnapshot = $derived({ ...snapshot, files: testFiles });
	const checks = $derived(snapshot.testChecks);
	const running = $derived(snapshot.activeRun !== null);
	const outOfDate = $derived(
		snapshot.gates.P5.checks.some((c) => c.detail === 'out of date') && checks !== null
	);
	const summary = $derived.by(() => {
		const tests = checks?.result?.tests ?? [];
		const manual = tests.filter((t) => t.status === 'todo' && describeTitle(t.title).manual).length;
		return { passed: checks?.result?.passed ?? 0, failed: checks?.result?.failed ?? 0, manual };
	});

	// Writable derived: a new `open` object replaces the selection, a click on a test replaces it too.
	const incoming = $derived(open);
	let opened = $derived<Open | undefined>(incoming);

	// A rejected Run tests shows in the gate panel (same action), so the tab shows no second banner.
	let checking = $state(false);
	const runTests: SubmitFunction = () => {
		checking = true;
		return async ({ update }) => {
			try {
				await update({ reset: false });
			} finally {
				checking = false;
			}
		};
	};

	// Explain failures: failing tests no open finding explains, on current results, no run active.
	let explaining = $state(false);
	const explain: SubmitFunction = () => {
		explaining = true;
		return async ({ update }) => {
			try {
				await update({ reset: false });
			} finally {
				explaining = false;
			}
		};
	};
	const unexplained = $derived(
		checks ? unexplainedFailures(checks.result, checks.findings).length : 0
	);
	const canExplain = $derived(unexplained > 0 && !outOfDate && (!running || explaining));
	const explainError = createFormError(() => form, ['triageTests']);

	// Fix automatically: the fix loop, on current results, no run active, with something to fix.
	let fixing = $state(false);
	const fixLoop: SubmitFunction = () => {
		fixing = true;
		return async ({ update }) => {
			try {
				await update({ reset: false });
			} finally {
				fixing = false;
			}
		};
	};
	const openFindings = $derived(
		checks ? checks.findings.filter((f) => findingOpen(f, checks.result)).length : 0
	);
	// `findingOpen` treats every unresolved finding as open without a result; the server needs one.
	// P5 must be ready as on the server (`p5NotReady`): P1, P2 and P4 approved, none stale.
	const phases = $derived(snapshot.state.phases);
	const p5Ready = $derived(
		phases.P1.status === 'approved' &&
			phases.P2.status === 'approved' &&
			phases.P4.status === 'approved'
	);
	const canFix = $derived(
		p5Ready &&
			checks?.result != null &&
			(openFindings > 0 || unexplained > 0) &&
			!outOfDate &&
			(!running || fixing)
	);
	const fixError = createFormError(() => form, ['fixLoop']);

	// A generation run shows its files; before the first event arrives it shows the planning state.
	const files = $derived(
		progress ?? (snapshot.activeRun?.phase === 'P5' && !hasTestFiles(snapshot.files) ? {} : null)
	);
	const reqs = $derived(snapshot.requirements?.requirements ?? []);
</script>

<Stack gap={4}>
	{#if files}
		<CodegenProgress {files} />
	{:else if hasTestFiles(snapshot.files)}
		<Cluster gap={3} align="center" justify="between">
			<Cluster gap={2} align="center">
				{#if checks?.result}
					<span class="summary aise-num"
						>{summary.passed} passed, {summary.failed} failed, {summary.manual} manual</span
					>
				{/if}
				{#if outOfDate}
					<Badge tone="pending">out of date</Badge>
				{/if}
			</Cluster>
			<Cluster gap={2} align="center">
				{#if canExplain}
					<form method="POST" action="?/triageTests" use:enhance={explain}>
						<Button
							type="submit"
							variant={canFix ? 'secondary' : 'primary'}
							size="sm"
							loading={running || explaining}>Explain failures</Button
						>
					</form>
				{/if}
				{#if canFix}
					<form method="POST" action="?/fixLoop" use:enhance={fixLoop}>
						<Button type="submit" variant="primary" size="sm" loading={running || fixing}
							>Fix automatically</Button
						>
					</form>
				{/if}
				<form method="POST" action="?/checkTests" use:enhance={runTests}>
					<Button type="submit" size="sm" loading={running || checking}>Run tests</Button>
				</form>
			</Cluster>
		</Cluster>

		{#if canExplain}
			<p class="note">
				{unexplained === 1 ? 'One failing test has' : `${unexplained} failing tests have`} no explanation
				yet. The test agent can decide whether the test or the code is wrong.
			</p>
		{/if}

		{#if explainError.message}
			<Banner tone="error" title="That did not work">
				{explainError.message}
				{#snippet actions()}
					<Button size="sm" variant="ghost" onclick={explainError.dismiss}>Dismiss</Button>
				{/snippet}
			</Banner>
		{/if}

		{#if fixError.message}
			<Banner tone="error" title="That did not work">
				{fixError.message}
				{#snippet actions()}
					<Button size="sm" variant="ghost" onclick={fixError.dismiss}>Dismiss</Button>
				{/snippet}
			</Banner>
		{/if}

		{#if outOfDate}
			<p class="note">These results describe older code or tests. Run the tests to update them.</p>
		{/if}

		{#if checks}
			<TestResults
				{checks}
				{reqs}
				design={snapshot.design}
				onOpen={(path, line) => (opened = { path, line })}
			/>
			<Findings
				findings={checks.findings}
				result={checks.result}
				testFixes={checks.testFixes}
				canApply={!running && !outOfDate}
				waitNote={running
					? undefined
					: 'The results are out of date. Run the tests again to apply a fix.'}
				{form}
			/>
		{:else}
			<p class="note">The tests have not run yet. Run them to see which pass.</p>
		{/if}

		<!-- Before any results there is no test row to click, so the files show without one. -->
		{#if opened || !checks}
			<section class="viewer" aria-label="Test file">
				<CodePanel snapshot={testSnapshot} open={opened} />
				{#if checks}
					<div>
						<Button size="sm" variant="ghost" onclick={() => (opened = undefined)}
							>Close file</Button
						>
					</div>
				{/if}
			</section>
		{/if}
	{:else}
		<p class="note">There are no tests yet.</p>
	{/if}
</Stack>

<style>
	.summary {
		font-size: var(--text-sm);
	}

	.note {
		color: var(--color-text-muted);
		font-size: var(--text-sm);
	}

	.viewer {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding-top: var(--space-4);
		border-top: 1px solid var(--color-border);
	}
</style>
