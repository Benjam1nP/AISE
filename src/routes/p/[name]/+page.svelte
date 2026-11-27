<script lang="ts">
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '$app/forms';
	import { onMount, tick, untrack } from 'svelte';
	import MessageSquare from '@lucide/svelte/icons/message-square';
	import Brand from '#lib/components/Brand.svelte';
	import Chat from '#lib/components/Chat.svelte';
	import CodegenProgress from '#lib/components/CodegenProgress.svelte';
	import CodePanel from '#lib/components/CodePanel.svelte';
	import DeployPanel from '#lib/components/DeployPanel.svelte';
	import DiagramsPanel, { type DiagramFocus } from '#lib/components/DiagramsPanel.svelte';
	import GatePanel from '#lib/components/GatePanel.svelte';
	import GenerateCode from '#lib/components/GenerateCode.svelte';
	import GenerateDeployment from '#lib/components/GenerateDeployment.svelte';
	import GenerateTests from '#lib/components/GenerateTests.svelte';
	import PhaseBar from '#lib/components/PhaseBar.svelte';
	import ProposalsPanel from '#lib/components/ProposalsPanel.svelte';
	import RequirementsPanel from '#lib/components/RequirementsPanel.svelte';
	import StaleBanner from '#lib/components/StaleBanner.svelte';
	import TestsPanel from '#lib/components/TestsPanel.svelte';
	import TicketsPanel from '#lib/components/TicketsPanel.svelte';
	import { hasDeployFiles, hasTestFiles } from '#lib/code-files.ts';
	import { codegenProgress } from '#lib/live-run.ts';
	import { traceNames, traceTarget } from '#lib/trace-nav.ts';
	import { TraceStore } from '#lib/trace-store.svelte.ts';
	import {
		activeTabId,
		attentionPhase,
		fileBelongsToTab,
		selectedTicketId,
		tabForFile,
		ticketsTabOpen,
		workPhase,
		workspaceTabs,
		type GatePhase,
		type WorkPhase
	} from '#lib/workspace-view.ts';
	import { WorkspaceStream } from '#lib/workspace-stream.svelte.ts';
	import {
		AppShell,
		Banner,
		EmptyState,
		Panel,
		SplitView,
		Stack,
		Tabs,
		ThemeToggle
	} from '#lib/ui/index.ts';
	import type { Proposal } from '#lib/server/core/tools/proposals.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const stream = new WorkspaceStream();
	onMount(() => stream.connect(data.snapshot.name));

	const snapshot = $derived(data.snapshot);

	// The traces behind the links between the tabs; fetched again when what they are built from changes.
	const traceStore = new TraceStore();
	const traceKey = $derived(
		JSON.stringify([
			snapshot.name,
			// A run can edit a file in place and a discard restores it; neither changes the list.
			snapshot.lastRun?.id,
			snapshot.lastRun?.status,
			snapshot.discardedRunIds.length,
			snapshot.files,
			snapshot.checks?.at,
			snapshot.testChecks?.at,
			snapshot.requirements?.requirements,
			snapshot.design
		])
	);
	$effect(() => {
		// A run changes files one by one; each fetch parses the code, so wait for the run to end.
		if (snapshot.activeRun) return;
		void traceStore.load(snapshot.name, traceKey);
	});
	const names = $derived(traceNames(snapshot.requirements?.requirements ?? [], snapshot.design));

	// The Tickets tab opens once the tests are approved, or as soon as a ticket exists.
	const ticketsTab = $derived(ticketsTabOpen(snapshot.state.phases, snapshot.tickets.length));

	// The chat follows the phase the developer picked (P7 shows the ticket chat); until then the phase
	// that needs attention.
	let picked: WorkPhase | undefined = $state();
	const phase = $derived<WorkPhase>(
		picked && !(picked === 'P7' && !ticketsTab)
			? picked
			: attentionPhase(snapshot.state.phases, snapshot.activeRun?.phase)
	);
	// Below `md` one pane shows at a time: the chat, or the gate and artefact tabs.
	let pane = $state<'left' | 'right'>('left');

	// The Code tab opens once there are files or a P4 run is writing them.
	const codeTab = $derived(snapshot.files.length > 0 || snapshot.activeRun?.phase === 'P4');
	// The Tests tab opens once there are test files or a P5 run is writing them.
	const testsTab = $derived(hasTestFiles(snapshot.files) || snapshot.activeRun?.phase === 'P5');
	// The Deploy tab opens once there are deploy files or a P6 run is writing them.
	const deployTab = $derived(hasDeployFiles(snapshot.files) || snapshot.activeRun?.phase === 'P6');
	const openTabs = $derived({
		code: codeTab,
		tests: testsTab,
		deploy: deployTab,
		tickets: ticketsTab
	});
	const tabs = $derived(workspaceTabs(openTabs));
	// Until the developer picks a tab, the page shows what the phase needs.
	let tab: string | undefined = $state();
	const activeTab = $derived(activeTabId(tab, phase, openTabs));
	// The ticket whose chat the left pane shows in P7: the Tickets tab reports it, so both agree.
	let ticketId: string | undefined = $state();
	const selectedTicket = $derived(
		snapshot.tickets.find(
			(t) => t.id === selectedTicketId(snapshot.tickets, ticketId, snapshot.tickets.length)
		)
	);
	let chat: ReturnType<typeof Chat> | undefined = $state();
	// The new ticket's form and description live here, so they survive a visit to the Diagrams tab.
	let ticketCreating = $state(false);
	let ticketDraft = $state('');
	// In P7, a diagram click goes to the new ticket while its form is open or no ticket exists.
	const draftTakesIds = $derived(
		phase === 'P7' && (ticketCreating || snapshot.tickets.length === 0)
	);
	/** An element ID clicked in a diagram: into the new ticket's description, else the chat message. */
	async function insertId(text: string) {
		// The P3 chat is read only: the ID goes to the design chat, like Discuss.
		if (phase === 'P3') {
			showDesignRun();
			await tick();
		}
		if (!draftTakesIds) return chat?.insert(text);
		const gap = ticketDraft === '' || /\s$/.test(ticketDraft) ? '' : ' ';
		ticketDraft = `${ticketDraft}${gap}${text}`;
	}

	let openFile: { path: string; line?: number } | undefined = $state();
	/** Shows a file of the generated code or tests, from a gate item or a test row. */
	function showFile(open: { path: string; line?: number }) {
		openFile = open;
		tab = tabForFile(open.path, testsTab);
		pane = 'right';
	}

	function pickTab(id: string) {
		tab = id;
		// A file opened from a gate item must not pull focus again when the tab is opened later.
		if (openFile && !fileBelongsToTab(id, openFile.path)) openFile = undefined;
	}

	function select(p: GatePhase | 'P3') {
		picked = p;
		if (p === 'P3') tab = 'diagrams';
		if (p === 'P4' && codeTab) tab = 'code';
		if (p === 'P5' && testsTab) tab = 'tests';
		if (p === 'P6' && deployTab) tab = 'deploy';
	}

	let tabsBox: HTMLElement | undefined = $state();
	/** Brings the tabs to the top, so a tab opened from elsewhere on the page is seen. */
	async function revealTabs() {
		await tick();
		tabsBox?.scrollIntoView({ block: 'start' });
	}

	/** P7: the tickets, with the ticket chat on the left. */
	function showTickets() {
		picked = 'P7';
		tab = 'tickets';
		void revealTabs();
	}

	/** The phase rail: P7 shows the tickets (the pane stays: it is the ticket chat now), the others pick the phase. */
	function selectRail(p: WorkPhase) {
		if (p === 'P7') showTickets();
		else select(p);
	}

	/** Accept started a design run: the design chat shows it. */
	function showDesignRun() {
		picked = 'P2';
		pane = 'left';
	}

	/** Discuss: the design chat opens with the proposal in the composer, to edit and send as a change request. */
	async function discuss(p: Proposal) {
		showDesignRun();
		await tick();
		chat?.insert(`Regarding ${p.id} (${p.title}): ${p.change}`);
	}

	/** A drift ticket was opened from the P4 gate: show it, its triage runs in its chat. */
	function showNewTicket() {
		ticketId = snapshot.tickets.at(-1)?.id;
		showTickets();
	}

	let reqFocus: { id: string } | undefined = $state();
	let diagramFocus: DiagramFocus | undefined = $state();
	/**
	 * A trace link or an affected ID of a ticket plan: a requirement opens its row, a design element
	 * the diagram that draws it, marked. Any other ID is ignored.
	 */
	function showId(id: string) {
		const target = traceTarget(id, snapshot.design);
		if (!target) {
			// A plan can name an element a later change removed: show the diagrams, nothing marked.
			if (/^(UC|SEQ|ACT|DSN)-/.test(id)) showDiagrams();
			return;
		}
		if (target.tab === 'requirements') reqFocus = { id };
		else diagramFocus = { id, kind: target.kind, seqId: target.seqId };
		pickTab(target.tab);
		pane = 'right';
		// The requirement row scrolls itself into view; a diagram needs the tabs brought up.
		if (target.tab === 'diagrams') void revealTabs();
	}

	function showDiagrams() {
		diagramFocus = undefined;
		pickTab('diagrams');
		pane = 'right';
		void revealTabs();
	}

	// A link's target applies once: leaving its tab drops it, so coming back does not jump there again.
	$effect(() => {
		if (activeTab !== 'requirements') reqFocus = undefined;
		if (activeTab !== 'diagrams') diagramFocus = undefined;
	});

	/** A ticket step that needs review in a phase: leave the Tickets tab for that phase's artefact. Phases the page cannot show are ignored. */
	function showPhase(p: string) {
		const target = workPhase(p);
		if (!target) return;
		tab = undefined;
		select(target);
		if (target === 'P2') tab = 'diagrams';
		pane = 'right';
	}

	const progress = $derived(
		codegenProgress(snapshot.codegen, stream.codegen, snapshot.activeRun?.runId)
	);
	// A generation run reports its files for the tab it writes to: P5 for the tests, else the code.
	const testRun = $derived(snapshot.activeRun?.phase === 'P5');
	const codeProgress = $derived(testRun ? null : progress);
	const testProgress = $derived(testRun ? progress : null);

	// The stored checks describe older code than the files on disk: run them once when the page opens.
	let checking = $state(false);
	const checksOutOfDate = $derived(
		snapshot.activeRun === null &&
			snapshot.files.length > 0 &&
			snapshot.gates.P4.checks.some((c) => c.detail === 'out of date')
	);
	/** Runs once, when the form mounts: later changes of the gate do not submit it again. */
	const checkOnOpen = (form: HTMLFormElement) => {
		if (untrack(() => checksOutOfDate)) form.requestSubmit();
	};
	const runAutoCheck: SubmitFunction = () => {
		checking = true;
		return async ({ update }) => {
			await update({ reset: false });
			checking = false;
		};
	};

	/** Shows the requirements gate, where the developer approves what an edit reopened. */
	function showRequirements() {
		picked = 'P1';
		tab = 'requirements';
	}

	const staleIds = $derived(snapshot.staleReqIds);
	const designChecks = $derived(snapshot.gates.P2.checks.filter((c) => !c.ok));
	const codeChecks = $derived(snapshot.gates.P4.checks.filter((c) => !c.ok));
	const testGateChecks = $derived(snapshot.gates.P5.checks.filter((c) => !c.ok));
	const deployGateChecks = $derived(snapshot.gates.P6.checks.filter((c) => !c.ok));
</script>

<svelte:head>
	<title>{snapshot.name} · AISE</title>
</svelte:head>

<form
	method="POST"
	action="?/checkCode"
	hidden
	use:enhance={runAutoCheck}
	{@attach checkOnOpen}
></form>

<AppShell grid>
	{#snippet header()}
		<Brand />
		<span class="slash" aria-hidden="true">/</span>
		<h1 class="project">{snapshot.name}</h1>
		<span class="grow"></span>
		<ThemeToggle />
	{/snippet}

	{#snippet subheader()}
		<PhaseBar
			phases={snapshot.state.phases}
			costByPhase={snapshot.costByPhase}
			selected={phase}
			onselect={selectRail}
		/>
	{/snippet}

	{#snippet main()}
		<div class="stack">
			{#if stream.lost}
				<Banner tone="warning" title="Connection lost, reconnecting...">
					The page keeps what it has and updates again once the connection is back.
				</Banner>
			{/if}
			<SplitView stickLeft bind:active={pane}>
				{#snippet left()}
					{#if phase === 'P7'}
						{#if selectedTicket}
							{#key selectedTicket.id}
								<Chat
									bind:this={chat}
									{snapshot}
									ticket={selectedTicket}
									live={stream.live}
									{form}
								/>
							{/key}
						{:else}
							<Panel title="Maintenance">
								<EmptyState
									icon={MessageSquare}
									title="No ticket yet"
									text="Create a ticket in the Tickets tab. The maintenance agent talks to you about it here."
								/>
							</Panel>
						{/if}
					{:else}
						<Chat bind:this={chat} {snapshot} {phase} live={stream.live} {form} />
					{/if}
				{/snippet}
				{#snippet right()}
					<Stack>
						{#if phase !== 'P7' && staleIds.length > 0}
							<StaleBanner
								ids={staleIds}
								failing={designChecks}
								running={snapshot.activeRun !== null}
								upstreamApproved={snapshot.state.phases.P1.status === 'approved'}
								onshowupstream={showRequirements}
								{form}
							/>
						{/if}
						{#if phase === 'P4'}
							{#if snapshot.staleDesignIds.length > 0}
								<StaleBanner
									phase="P4"
									ids={snapshot.staleDesignIds}
									failing={codeChecks}
									running={snapshot.activeRun !== null}
									upstreamApproved={snapshot.state.phases.P2.status === 'approved'}
									onshowupstream={() => (picked = 'P2')}
									{form}
								/>
							{/if}
							<GenerateCode {snapshot} {form} />
						{/if}
						{#if phase === 'P5'}
							{#if snapshot.staleTestIds.length > 0}
								<StaleBanner
									phase="P5"
									ids={snapshot.staleTestIds}
									failing={testGateChecks}
									running={snapshot.activeRun !== null}
									upstreamApproved={snapshot.state.phases.P4.status === 'approved'}
									onshowupstream={() => (picked = 'P4')}
									{form}
								/>
							{/if}
							<GenerateTests {snapshot} {form} />
						{/if}
						{#if phase === 'P6'}
							{#if snapshot.staleDeployIds.length > 0}
								<StaleBanner
									phase="P6"
									ids={snapshot.staleDeployIds}
									failing={deployGateChecks}
									running={snapshot.activeRun !== null}
									upstreamApproved={snapshot.state.phases.P5.status === 'approved'}
									onshowupstream={() => (picked = 'P5')}
									{form}
								/>
							{/if}
							<GenerateDeployment {snapshot} {form} />
						{/if}
						{#if phase === 'P3'}
							<ProposalsPanel
								proposals={snapshot.proposals}
								status={snapshot.state.phases.P3.status}
								hasDesign={snapshot.design !== null}
								running={snapshot.activeRun !== null}
								ondiscuss={discuss}
								onaccepted={showDesignRun}
								{form}
							/>
						{:else if phase !== 'P7'}
							<GatePanel
								{snapshot}
								{phase}
								{form}
								{checking}
								onopenfile={showFile}
								onopendriftticket={showNewTicket}
							/>
						{/if}
						<div class="tabs-box" bind:this={tabsBox}>
							<Tabs {tabs} bind:active={() => activeTab, pickTab}>
								{#snippet children(active)}
									{#if active === 'diagrams'}
										<DiagramsPanel
											diagrams={snapshot.diagrams}
											design={snapshot.design}
											oninsert={insertId}
											focus={diagramFocus}
											traces={traceStore.traces}
											{names}
											onopenid={showId}
											onopenfile={showFile}
										/>
									{:else if active === 'code'}
										{#if codeProgress}
											<CodegenProgress files={codeProgress} />
										{:else}
											<CodePanel {snapshot} open={openFile} onopenid={showId} />
										{/if}
									{:else if active === 'tests'}
										<TestsPanel
											{snapshot}
											{form}
											progress={testProgress}
											open={openFile}
											onopenid={showId}
										/>
									{:else if active === 'deploy'}
										<DeployPanel {snapshot} />
									{:else if active === 'tickets'}
										<TicketsPanel
											{snapshot}
											{form}
											bind:selectedId={ticketId}
											bind:creating={ticketCreating}
											bind:draft={ticketDraft}
											onopenid={showId}
											onopenfile={showFile}
											onselectphase={showPhase}
										/>
									{:else}
										<RequirementsPanel
											{snapshot}
											traces={traceStore.traces}
											{names}
											focus={reqFocus}
											onopenid={showId}
											onopenfile={showFile}
										/>
									{/if}
								{/snippet}
							</Tabs>
						</div>
					</Stack>
				{/snippet}
			</SplitView>
		</div>
	{/snippet}
</AppShell>

<style>
	.slash {
		color: var(--color-border-strong);
		font-size: var(--text-lg);
	}

	.project {
		overflow: hidden;
		font-family: var(--font-mono);
		font-size: var(--text-base);
		font-weight: var(--weight-medium);
		letter-spacing: 0;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.grow {
		flex: 1;
	}

	/* The tabs scroll into view below the sticky header. */
	.tabs-box {
		scroll-margin-top: calc(var(--shell-top, 0px) + var(--space-4));
	}

	.stack {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}
</style>
