import { describe, expect, it } from 'vitest';
import type { Ticket } from '../core/schemas/tickets';
import { PHASES, type PhaseStatus, type State } from '../core/state';
import type { RunFindings } from '../core/test-state';
import {
	closeNotReady,
	entryRan,
	notReproduced,
	p7Status,
	planNotReady,
	restoreTicket,
	ticketBefore,
	ticketRunRefused,
	ticketSteps,
	walkPhases
} from './tickets';

const ORDER = ['P1', 'P2', 'P4', 'P5'] as const;
const WITH_P6 = ['P1', 'P2', 'P4', 'P5', 'P6'] as const;
const ORDERS: [readonly string[]][] = [[ORDER], [WITH_P6]];

/** Every phase `approved` unless named in `over`. */
function state(over: Partial<Record<(typeof PHASES)[number], PhaseStatus>> = {}): State {
	const phases = Object.fromEntries(
		PHASES.map((p) => [p, { status: over[p] ?? 'approved' }])
	) as State['phases'];
	return { phases };
}

const plan = (entry: 'P1' | 'P2' | 'P4' | 'P5' = 'P1'): NonNullable<Ticket['plan']> => ({
	entry,
	affectedIds: ['REQ-001'],
	files: [],
	steps: ['change REQ-001']
});

const report: NonNullable<Ticket['report']> = {
	at: '2026-11-22T10:00:00.000Z',
	text: 'done',
	steps: [],
	changedIds: [],
	files: [],
	tests: null
};

function ticket(over: Partial<Ticket> = {}): Ticket {
	return {
		id: 'TCK-001',
		kind: 'change',
		title: 't',
		description: '',
		status: 'in_progress',
		createdAt: '2026-11-22T09:00:00.000Z',
		plan: plan(),
		...over
	};
}

const phasesOf = (order: readonly string[], s: State, entry: string) =>
	walkPhases(order, s, entry).map((step) => step.phase);

describe('walkPhases', () => {
	it.each(ORDERS)('from P1 skips a phase that is not started (order %#)', (order) => {
		expect(phasesOf(order, state({ P5: 'not_started', P6: 'not_started' }), 'P1')).toEqual([
			'P1',
			'P2',
			'P4'
		]);
	});

	it.each(ORDERS)('from P2 leaves out P1 (order %#)', (order) => {
		expect(phasesOf(order, state({ P6: 'not_started' }), 'P2')).toEqual(['P2', 'P4', 'P5']);
	});

	it.each(ORDERS)('keeps the entry phase when it is not started (order %#)', (order) => {
		const walk = walkPhases(order, state({ P5: 'not_started', P6: 'not_started' }), 'P5');
		expect(walk).toEqual([{ phase: 'P5', status: 'not_started', entry: true }]);
	});

	it('marks only the entry step and carries the live status', () => {
		expect(walkPhases(ORDER, state({ P4: 'stale' }), 'P2')).toEqual([
			{ phase: 'P2', status: 'approved', entry: true },
			{ phase: 'P4', status: 'stale', entry: false },
			{ phase: 'P5', status: 'approved', entry: false }
		]);
	});

	it('P6 joins the walk once it is in the order and started', () => {
		expect(phasesOf(WITH_P6, state(), 'P4')).toEqual(['P4', 'P5', 'P6']);
		expect(phasesOf(WITH_P6, state({ P6: 'not_started' }), 'P4')).toEqual(['P4', 'P5']);
		expect(phasesOf(ORDER, state(), 'P4')).toEqual(['P4', 'P5']);
	});
});

describe('planNotReady', () => {
	it.each(ORDERS)('entry P2 with P1 awaiting approval names P1 (order %#)', (order) => {
		expect(planNotReady(order, state({ P1: 'awaiting_approval' }), 'P2')).toMatch(/\bP1\b/);
	});

	it.each(ORDERS)('entry P5 with P4 stale names P4 (order %#)', (order) => {
		expect(planNotReady(order, state({ P4: 'stale' }), 'P5')).toMatch(/^P4 is stale/);
	});

	it('names the earliest phase to fix', () => {
		expect(planNotReady(ORDER, state({ P2: 'stale', P4: 'stale' }), 'P5')).toMatch(/\bP2\b/);
	});

	it('ignores earlier phases that are not started', () => {
		expect(planNotReady(ORDER, state({ P1: 'not_started' }), 'P2')).toBeNull();
	});

	it('ignores the entry phase and later phases unless running', () => {
		expect(planNotReady(ORDER, state({ P2: 'stale', P4: 'awaiting_approval' }), 'P2')).toBeNull();
	});

	it.each(ORDERS)('refuses while any phase in the order is running (order %#)', (order) => {
		expect(planNotReady(order, state({ P5: 'running' }), 'P1')).toMatch(/\bP5\b/);
		expect(planNotReady(order, state({ P2: 'running' }), 'P2')).toMatch(/\bP2\b/);
	});

	it('refuses while P6 runs once P6 is in the order', () => {
		expect(planNotReady(WITH_P6, state({ P6: 'running' }), 'P1')).toMatch(/\bP6\b/);
	});

	it.each(ORDERS)('is null when all are approved (order %#)', (order) => {
		expect(planNotReady(order, state(), 'P5')).toBeNull();
	});
});

describe('closeNotReady', () => {
	it.each(ORDERS)(
		'names the first stale phase, then the one awaiting approval (order %#)',
		(order) => {
			const t = ticket({ plan: plan('P1') });
			expect(closeNotReady(order, state({ P2: 'stale', P4: 'awaiting_approval' }), t)).toMatch(
				/^P2 is stale/
			);
			expect(closeNotReady(order, state({ P4: 'awaiting_approval' }), t)).toMatch(/^Approve P4/);
		}
	);

	it('refuses while a walk phase is running', () => {
		expect(closeNotReady(ORDER, state({ P5: 'running' }), ticket())).toMatch(/^P5 is running/);
	});

	it('refuses while the entry phase has not started', () => {
		const t = ticket({ plan: plan('P5') });
		expect(closeNotReady(ORDER, state({ P5: 'not_started' }), t)).toMatch(/\bP5\b/);
	});

	it('ignores phases before the entry and phases not started', () => {
		const t = ticket({ plan: plan('P4') });
		expect(closeNotReady(ORDER, state({ P1: 'stale', P2: 'stale' }), t)).toBeNull();
		expect(closeNotReady(WITH_P6, state({ P6: 'not_started' }), t)).toBeNull();
	});

	it('P6 must be approved once it is in the order and started', () => {
		expect(closeNotReady(WITH_P6, state({ P6: 'stale' }), ticket())).toMatch(/\bP6\b/);
		expect(closeNotReady(ORDER, state({ P6: 'stale' }), ticket())).toBeNull();
	});

	it.each(ORDERS)('is null when all walk phases are approved (order %#)', (order) => {
		expect(closeNotReady(order, state(), ticket())).toBeNull();
	});

	it('names a ticket in progress without a plan', () => {
		const t = ticket({ plan: undefined });
		expect(closeNotReady(ORDER, state(), t)).toMatch(/^TCK-001 has no plan/);
	});

	it('refuses, without throwing, a plan whose entry is not in the order', () => {
		const t = ticket({ plan: plan('P5') });
		expect(closeNotReady(['P1', 'P2'], state(), t)).toMatch(/^P5 is not a phase of the walk/);
	});

	it.each(['open', 'triaged', 'done', 'rejected'] as const)(
		'refuses a ticket that is %s',
		(status) => {
			expect(closeNotReady(ORDER, state(), ticket({ status }))).not.toBeNull();
		}
	);
});

describe('ticketSteps', () => {
	it('is the walk from the plan entry', () => {
		const steps = ticketSteps(ORDER, state(), ticket({ plan: plan('P2') }));
		expect(steps.map((x) => x.phase)).toEqual(['P2', 'P4', 'P5']);
	});

	it('is empty without a plan', () => {
		expect(ticketSteps(ORDER, state(), ticket({ plan: undefined }))).toEqual([]);
	});

	it('is empty, without throwing, when the entry is not in the order', () => {
		expect(ticketSteps(['P1', 'P2'], state(), ticket({ plan: plan('P5') }))).toEqual([]);
	});
});

describe('p7Status', () => {
	it('is not started without tickets', () => {
		expect(p7Status([], null)).toBe('not_started');
	});

	it('is running while a ticket run is active', () => {
		expect(p7Status([ticket({ status: 'open' })], { phase: 'P7', ticketId: 'TCK-001' })).toBe(
			'running'
		);
	});

	it('a phase run of a ticket in progress is not a P7 run: P7 is not running', () => {
		expect(p7Status([ticket()], { phase: 'P1', ticketId: 'TCK-001' })).toBe('awaiting_approval');
	});

	it('a run without a ticket does not count as a ticket run', () => {
		expect(p7Status([ticket({ status: 'done' })], { phase: 'P7' })).toBe('approved');
		expect(p7Status([], { phase: 'P7' })).toBe('not_started');
	});

	it.each(['open', 'triaged', 'in_progress'] as const)(
		'awaits approval while a ticket is %s',
		(status) => {
			expect(p7Status([ticket({ status: 'done' }), ticket({ id: 'TCK-002', status })], null)).toBe(
				'awaiting_approval'
			);
		}
	);

	it('is approved when every ticket is done or rejected', () => {
		expect(
			p7Status([ticket({ status: 'done' }), ticket({ id: 'TCK-002', status: 'rejected' })], null)
		).toBe('approved');
	});
});

describe('ticketBefore and restoreTicket', () => {
	it('records status, plan and report only', () => {
		const t = ticket({ status: 'done', report });
		expect(ticketBefore(t)).toEqual({ status: 'done', plan: plan(), report });
		expect(ticketBefore(ticket({ status: 'open', plan: undefined }))).toEqual({ status: 'open' });
	});

	it('back to open drops the plan', () => {
		const before = ticketBefore(ticket({ status: 'open', plan: undefined }));
		const after = restoreTicket(ticket({ status: 'triaged' }), before);
		expect(after.status).toBe('open');
		expect('plan' in after).toBe(false);
		expect(after.title).toBe('t');
	});

	it('back to in progress drops the report', () => {
		const before = ticketBefore(ticket());
		const after = restoreTicket(ticket({ status: 'done', report }), before);
		expect(after.status).toBe('in_progress');
		expect(after.plan).toEqual(plan());
		expect('report' in after).toBe(false);
	});

	it('back to triaged puts the earlier plan back', () => {
		const before = ticketBefore(ticket({ status: 'triaged', plan: plan('P1') }));
		const after = restoreTicket(ticket({ status: 'triaged', plan: plan('P2') }), before);
		expect(after.plan?.entry).toBe('P1');
	});
});

describe('ticketRunRefused', () => {
	it.each(['done', 'rejected'] as const)('refuses a new run for a %s ticket', (status) => {
		expect(ticketRunRefused(ticket({ status }))).toMatch(/TCK-001/);
	});

	it.each(['open', 'triaged', 'in_progress'] as const)('allows a run for a %s ticket', (status) => {
		expect(ticketRunRefused(ticket({ status }))).toBeNull();
	});
});

describe('notReproduced', () => {
	const bug = ticket({ kind: 'bug', plan: plan('P5') });
	const none: RunFindings = { findings: [], testFixes: [], fixResults: [] };
	const one: RunFindings = {
		findings: [
			{
				id: 'F-1',
				runId: 'r',
				test: 't',
				file: 'test/a.test.ts',
				explanation: 'e',
				proposedFix: 'f'
			}
		],
		testFixes: [],
		fixResults: []
	};

	it('is true when the P5 runs reported no code bug', () => {
		expect(notReproduced(bug, [none])).toBe(true);
		expect(notReproduced(bug, [none, none])).toBe(true);
	});

	it('is false once a P5 run reported a code bug', () => {
		expect(notReproduced(bug, [none, one])).toBe(false);
	});

	it('is false before any P5 run', () => {
		expect(notReproduced(bug, [])).toBe(false);
	});

	it('a test fix report is not a code bug', () => {
		const fix: RunFindings = {
			findings: [],
			testFixes: [{ runId: 'r', test: 't', file: 'test/a.test.ts', reason: 'wrong' }],
			fixResults: []
		};
		expect(notReproduced(bug, [fix])).toBe(true);
	});

	it('is false for a change ticket', () => {
		expect(notReproduced(ticket({ kind: 'change' }), [none])).toBe(false);
	});

	it('is false for a bug ticket that is not in progress', () => {
		expect(notReproduced({ ...bug, status: 'triaged' }, [none])).toBe(false);
		expect(notReproduced({ ...bug, status: 'done' }, [none])).toBe(false);
	});
});

describe('entryRan', () => {
	type R = Parameters<typeof entryRan>[1][number];
	const run = (over: Partial<R> = {}): R => ({
		phase: 'P2',
		ticketId: 'TCK-001',
		status: 'done',
		entry: true,
		...over
	});
	const t = ticket({ plan: plan('P2') });

	it('is true with a finished run of the ticket in its entry phase', () => {
		expect(entryRan(t, [run({ phase: 'P7' }), run()])).toBe(true);
	});

	it('is false while the entry run failed, was discarded or is still running', () => {
		for (const status of ['failed', 'discarded', 'running'] as const) {
			expect(entryRan(t, [run({ status })])).toBe(false);
		}
	});

	it('is false for a finished run in the entry phase that did not start from the entry brief', () => {
		// A Retry in the phase chat resends only the plain line; no agent saw the plan.
		expect(entryRan(t, [run({ entry: undefined })])).toBe(false);
	});

	it('is false for runs in another phase or of another ticket, and without a plan', () => {
		expect(entryRan(t, [run({ phase: 'P4' }), run({ phase: 'P7' })])).toBe(false);
		expect(entryRan(t, [run({ ticketId: 'TCK-002' }), run({ ticketId: undefined })])).toBe(false);
		expect(entryRan(ticket({ plan: undefined }), [run()])).toBe(false);
	});
});
