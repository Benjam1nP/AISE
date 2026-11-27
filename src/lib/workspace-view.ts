import type { PhaseId, State } from '#lib/server/core/state.ts';
import type { TabItem } from '#lib/ui/index.ts';

/** The phases with a gate and a phase chat. */
export type GatePhase = 'P1' | 'P2' | 'P4' | 'P5' | 'P6';
/** What the rail can select: a gate phase, P3 (the design review, no gate) or P7 (the tickets, with the ticket chat). */
export type WorkPhase = GatePhase | 'P3' | 'P7';

/**
 * The phase the page shows until the developer picks one: the one with a run, else the first one
 * whose inputs are approved and which is not approved itself. P5 needs P1, P2 and P4 approved, P6
 * needs P5 as well.
 */
export function attentionPhase(phases: State['phases'], activeRun: PhaseId | undefined): GatePhase {
	const approved = (p: PhaseId) => phases[p]?.status === 'approved';
	if (activeRun === 'P6') return 'P6';
	if (activeRun === 'P5') return 'P5';
	if (activeRun === 'P4') return 'P4';
	const designNext = approved('P1') && !approved('P2');
	if (activeRun === 'P2' || designNext) return 'P2';
	const upToCode = approved('P1') && approved('P2') && approved('P4');
	if (upToCode && approved('P5') && !approved('P6')) return 'P6';
	if (upToCode && !approved('P5')) return 'P5';
	return approved('P2') && !approved('P4') ? 'P4' : 'P1';
}

const isTestPath = (path: string) => path.startsWith('test/');

/** The tab that shows a file: a test file in the Tests tab when it exists, anything else in Code. */
export function tabForFile(path: string, testsTab: boolean): 'code' | 'tests' {
	return isTestPath(path) && testsTab ? 'tests' : 'code';
}

/** Whether a file opened from a gate item belongs to a tab: `test/` to Tests, other files to Code. */
export function fileBelongsToTab(tab: string, path: string): boolean {
	return tab === 'tests' ? isTestPath(path) : tab === 'code' ? !isTestPath(path) : false;
}

/** The Tickets tab opens once the tests are approved (or stale after a change), or a ticket exists. */
export function ticketsTabOpen(phases: State['phases'], ticketCount: number): boolean {
	const p5 = phases.P5?.status;
	return p5 === 'approved' || p5 === 'stale' || ticketCount > 0;
}

/** A phase with a gate that a ticket step can open. */
export function workPhase(phase: string): GatePhase | undefined {
	return phase === 'P1' || phase === 'P2' || phase === 'P4' || phase === 'P5' || phase === 'P6'
		? phase
		: undefined;
}

/** Which of the tabs that wait for something are open. */
export type OpenTabs = { code: boolean; tests: boolean; deploy: boolean; tickets: boolean };

/** The tab bar: Code, Tests, Deploy and Tickets stay disabled with a hint until they are open. */
export function workspaceTabs(open: OpenTabs): TabItem[] {
	const gated = (id: string, label: string, isOpen: boolean, hint: string): TabItem =>
		isOpen ? { id, label } : { id, label, disabled: true, hint };
	return [
		{ id: 'requirements', label: 'Requirements' },
		{ id: 'diagrams', label: 'Diagrams' },
		gated('code', 'Code', open.code, 'Available once the code is generated'),
		gated('tests', 'Tests', open.tests, 'Available once the tests are generated'),
		gated('deploy', 'Deploy', open.deploy, 'Available once the deployment is generated'),
		gated('tickets', 'Tickets', open.tickets, 'Available once the tests are approved'),
		{ id: 'trace', label: 'Trace', disabled: true, hint: 'Available from week 2' }
	];
}

/**
 * The tab to show: the one the developer picked while it is open, else (also when it closed) the
 * one the phase needs: Code for P4, Tests for P5, Deploy for P6, Tickets for P7, Requirements
 * otherwise.
 */
export function activeTabId(picked: string | undefined, phase: WorkPhase, open: OpenTabs): string {
	const isOpen = (id: string) =>
		id === 'code' || id === 'tests' || id === 'deploy' || id === 'tickets' ? open[id] : true;
	if (picked !== undefined) return isOpen(picked) ? picked : 'requirements';
	if (phase === 'P4' && open.code) return 'code';
	if (phase === 'P5' && open.tests) return 'tests';
	if (phase === 'P6' && open.deploy) return 'deploy';
	if (phase === 'P7' && open.tickets) return 'tickets';
	return 'requirements';
}

/**
 * The ticket the page shows: one that appeared after the developer's last choice (`seen` tickets
 * then), else the choice while it exists, else the ticket in progress (it needs them most), else
 * the newest.
 */
export function selectedTicketId(
	tickets: readonly { id: string; status: string }[],
	chosen: string | undefined,
	seen: number
): string | undefined {
	if (tickets.length > seen) return tickets.at(-1)?.id;
	return (
		tickets.find((t) => t.id === chosen) ??
		tickets.find((t) => t.status === 'in_progress') ??
		tickets.at(-1)
	)?.id;
}
