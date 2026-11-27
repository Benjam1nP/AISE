import type { RunMeta } from '../core/runs';
import type { Ticket } from '../core/schemas/tickets';
import type { PhaseId, PhaseStatus, State } from '../core/state';
import type { RunFindings } from '../core/test-state';

/*
 * Ticket walk rules (spec "Walk"; plan Deviations 2 and 4). Pure: the phase order is a parameter,
 * so this module never lists phases; the orchestrator passes its chat phases.
 */

export type TicketStep = { phase: string; status: PhaseStatus; entry: boolean };

const statusOf = (state: State, phase: string): PhaseStatus =>
	state.phases[phase as PhaseId]?.status ?? 'not_started';

/** Phases of the walk: `order` from `entry` on, minus those not started (entry always kept). */
export function walkPhases(order: readonly string[], state: State, entry: string): TicketStep[] {
	const from = order.indexOf(entry);
	if (from < 0) throw new Error(`${entry} is not a phase of the walk`);
	return order
		.slice(from)
		.map((phase) => ({ phase, status: statusOf(state, phase), entry: phase === entry }))
		.filter((step) => step.entry || step.status !== 'not_started');
}

/** The walk of a ticket for the view: empty without a plan or when its entry is not in `order`. */
export function ticketSteps(order: readonly string[], state: State, t: Ticket): TicketStep[] {
	if (!t.plan || !order.includes(t.plan.entry)) return [];
	return walkPhases(order, state, t.plan.entry);
}

/**
 * Why the plan cannot be approved yet, naming the phase to fix; null when it can. Every phase
 * before `entry` in `order` that is not `not_started` must be `approved`; no phase may be
 * `running`. The entry phase's own precondition stays in the orchestrator.
 */
export function planNotReady(order: readonly string[], state: State, entry: string): string | null {
	const running = order.find((p) => statusOf(state, p) === 'running');
	if (running) return `${running} is running; wait for it before approving the plan`;
	const from = order.indexOf(entry);
	if (from < 0) throw new Error(`${entry} is not a phase of the walk`);
	for (const phase of order.slice(0, from)) {
		const status = statusOf(state, phase);
		if (status === 'stale')
			return `${phase} is stale; update it or confirm it is still valid before approving the plan`;
		if (status !== 'approved' && status !== 'not_started')
			return `Approve ${phase} before approving the plan`;
	}
	return null;
}

/** Why the ticket cannot close, naming the first walk phase that is not approved; null when it can. */
export function closeNotReady(
	order: readonly string[],
	state: State,
	ticket: Ticket
): string | null {
	if (ticket.status !== 'in_progress')
		return `${ticket.id} is not in progress; only a ticket in progress can close`;
	if (!ticket.plan) return `${ticket.id} has no plan; it cannot close without one`;
	if (!order.includes(ticket.plan.entry))
		return `${ticket.plan.entry} is not a phase of the walk; the ticket cannot close`;
	const step = walkPhases(order, state, ticket.plan.entry).find((s) => s.status !== 'approved');
	if (!step) return null;
	if (step.status === 'stale')
		return `${step.phase} is stale; update it or confirm it is still valid before closing the ticket`;
	if (step.status === 'running')
		return `${step.phase} is running; wait for it before closing the ticket`;
	return `Approve ${step.phase} before closing the ticket`;
}

/**
 * Derived P7 status (Deviation 4): `running` while a P7 run of a ticket is active (a phase run of
 * the ticket in progress shows on its own phase), `awaiting_approval`
 * while a ticket is open, triaged or in progress, `approved` when all are done or rejected,
 * `not_started` without tickets.
 */
export function p7Status(
	tickets: Ticket[],
	activeRun: { phase: string; ticketId?: string } | null
): PhaseStatus {
	if (activeRun?.phase === 'P7' && activeRun.ticketId) return 'running';
	if (tickets.length === 0) return 'not_started';
	const settled = tickets.every((t) => t.status === 'done' || t.status === 'rejected');
	return settled ? 'approved' : 'awaiting_approval';
}

/** Why no run may start for the ticket: a done or rejected ticket never gets a new run. */
export function ticketRunRefused(t: Ticket): string | null {
	if (t.status === 'done' || t.status === 'rejected') return `${t.id} is ${t.status}`;
	return null;
}

/**
 * Whether the ticket's entry run happened: a run of the ticket in its entry phase, started from
 * the entry brief (RunMeta.entry), that finished and is not discarded. Derived from the runs, so a
 * failed or discarded entry run never counts, even when the phase quietly went back to approved,
 * and neither does a Retry in the phase chat, which resends only the plain line.
 */
export function entryRan(
	t: Ticket,
	runs: readonly Pick<RunMeta, 'phase' | 'ticketId' | 'status' | 'entry'>[]
): boolean {
	const entry = t.plan?.entry;
	return (
		entry !== undefined &&
		runs.some(
			(r) => r.ticketId === t.id && r.entry === true && r.phase === entry && r.status === 'done'
		)
	);
}

/** The ticket state a run records and discard restores. */
export const ticketBefore = (t: Ticket): NonNullable<RunMeta['prevTicket']> => ({
	status: t.status,
	...(t.plan && { plan: t.plan }),
	...(t.report && { report: t.report })
});

/** `t` with status, plan and report from `prev` (a missing plan or report is removed). */
export function restoreTicket(t: Ticket, prev: NonNullable<RunMeta['prevTicket']>): Ticket {
	const out: Ticket = { ...t, ...prev };
	if (!prev.plan) delete out.plan;
	if (!prev.report) delete out.report;
	return out;
}

/**
 * Bug ticket in progress whose P5 runs reported no code bug (`readRunFindings` per run is passed
 * in). A test fix report is not a code bug. False before the first P5 run.
 */
export function notReproduced(t: Ticket, p5RunFindings: RunFindings[]): boolean {
	return (
		t.kind === 'bug' &&
		t.status === 'in_progress' &&
		p5RunFindings.length > 0 &&
		p5RunFindings.every((r) => r.findings.length === 0)
	);
}
