import { describe, expect, it } from 'vitest';
import {
	activeTabId,
	attentionPhase,
	fileBelongsToTab,
	tabForFile,
	selectedTicketId,
	tabForId,
	ticketsTabOpen,
	workPhase,
	workspaceTabs
} from './workspace-view.ts';

const phases = (over: Record<string, string> = {}) =>
	Object.fromEntries(
		Object.entries({
			P1: 'approved',
			P2: 'approved',
			P4: 'approved',
			P5: 'not_started',
			P6: 'not_started',
			...over
		}).map(([k, status]) => [k, { status }])
	) as never;

describe('attentionPhase', () => {
	it('is P5 once P1, P2 and P4 are approved and P5 is not', () => {
		expect(attentionPhase(phases(), undefined)).toBe('P5');
		expect(attentionPhase(phases({ P5: 'awaiting_approval' }), undefined)).toBe('P5');
	});

	it('is P6 once P1 to P5 are approved and P6 is not', () => {
		expect(attentionPhase(phases({ P5: 'approved' }), undefined)).toBe('P6');
		expect(attentionPhase(phases({ P5: 'approved', P6: 'awaiting_approval' }), undefined)).toBe(
			'P6'
		);
	});

	it('stays off P5 and P6 when both are approved', () => {
		expect(attentionPhase(phases({ P5: 'approved', P6: 'approved' }), undefined)).toBe('P1');
	});

	it('stays on P4 when P4 is stale, even with P5 approved', () => {
		expect(attentionPhase(phases({ P4: 'stale', P5: 'approved' }), undefined)).toBe('P4');
	});

	it('stays on P2 when the design awaits approval, even with P5 approved', () => {
		expect(attentionPhase(phases({ P2: 'awaiting_approval', P5: 'approved' }), undefined)).toBe(
			'P2'
		);
	});

	it('is P6 when P6 is stale', () => {
		expect(attentionPhase(phases({ P5: 'approved', P6: 'stale' }), undefined)).toBe('P6');
	});

	it('does not throw for a project without a P6 key, and then asks for P6 after P5', () => {
		const old = Object.fromEntries(
			['P1', 'P2', 'P4', 'P5'].map((k) => [k, { status: 'approved' }])
		) as never;
		expect(attentionPhase(old, undefined)).toBe('P6');
	});

	it('does not jump to P6 while P5 is stale', () => {
		expect(attentionPhase(phases({ P5: 'stale' }), undefined)).toBe('P5');
	});

	it('does not jump to P5 while an upstream phase is open or stale', () => {
		// P4 approved but the design was reopened: the design needs the developer first.
		expect(attentionPhase(phases({ P2: 'awaiting_approval' }), undefined)).toBe('P2');
		expect(attentionPhase(phases({ P1: 'stale' }), undefined)).toBe('P1');
		expect(attentionPhase(phases({ P4: 'stale' }), undefined)).toBe('P4');
	});

	it('follows an active run first', () => {
		expect(attentionPhase(phases(), 'P4')).toBe('P4');
		expect(attentionPhase(phases({ P4: 'not_started' }), 'P5')).toBe('P5');
		expect(attentionPhase(phases(), 'P2')).toBe('P2');
		expect(attentionPhase(phases({ P5: 'not_started' }), 'P6')).toBe('P6');
	});

	it('keeps the earlier rules', () => {
		expect(attentionPhase(phases({ P2: 'not_started', P4: 'not_started' }), undefined)).toBe('P2');
		expect(attentionPhase(phases({ P4: 'awaiting_approval' }), undefined)).toBe('P4');
		expect(
			attentionPhase(phases({ P1: 'not_started', P2: 'not_started', P4: 'not_started' }), undefined)
		).toBe('P1');
	});
});

describe('tabForFile', () => {
	it('sends a test file to the Tests tab only when that tab is available', () => {
		expect(tabForFile('test/UC-001.test.ts', true)).toBe('tests');
		expect(tabForFile('test/UC-001.test.ts', false)).toBe('code');
		expect(tabForFile('src/A.ts', true)).toBe('code');
	});
});

describe('fileBelongsToTab', () => {
	it('keeps a file only for its own tab', () => {
		expect(fileBelongsToTab('tests', 'test/a.test.ts')).toBe(true);
		expect(fileBelongsToTab('tests', 'src/a.ts')).toBe(false);
		expect(fileBelongsToTab('code', 'src/a.ts')).toBe(true);
		expect(fileBelongsToTab('code', 'test/a.test.ts')).toBe(false);
		expect(fileBelongsToTab('requirements', 'src/a.ts')).toBe(false);
	});
});

describe('ticketsTabOpen', () => {
	it('opens once the tests are approved or stale', () => {
		expect(ticketsTabOpen(phases({ P5: 'approved' }), 0)).toBe(true);
		expect(ticketsTabOpen(phases({ P5: 'stale' }), 0)).toBe(true);
	});

	it('stays closed before the tests are approved while there is no ticket', () => {
		expect(ticketsTabOpen(phases({ P5: 'not_started' }), 0)).toBe(false);
		expect(ticketsTabOpen(phases({ P5: 'awaiting_approval' }), 0)).toBe(false);
		expect(ticketsTabOpen(phases({ P5: 'running' }), 0)).toBe(false);
	});

	it('opens for an existing ticket whatever P5 says', () => {
		expect(ticketsTabOpen(phases({ P5: 'not_started' }), 1)).toBe(true);
	});
});

describe('tabForId', () => {
	it('sends a requirement to the Requirements tab', () => {
		expect(tabForId('REQ-001')).toBe('requirements');
	});

	it('sends design IDs to the Diagrams tab', () => {
		for (const id of ['UC-001', 'SEQ-002', 'ACT-001', 'DSN-003'])
			expect(tabForId(id)).toBe('diagrams');
	});

	it('ignores anything else', () => {
		expect(tabForId('TCK-001')).toBeUndefined();
		expect(tabForId('REQUIREMENT')).toBeUndefined();
	});
});

describe('workPhase', () => {
	it('keeps the phases the page can show and drops the rest', () => {
		for (const p of ['P1', 'P2', 'P4', 'P5', 'P6']) expect(workPhase(p)).toBe(p);
		for (const p of ['P3', 'P7', 'x']) expect(workPhase(p)).toBeUndefined();
	});
});

const closed = { code: false, tests: false, deploy: false, tickets: false };
const open = { code: true, tests: true, deploy: true, tickets: true };

describe('workspaceTabs', () => {
	it('lists the tabs in the order Requirements, Diagrams, Code, Tests, Deploy, Tickets, Trace', () => {
		expect(workspaceTabs(open).map((t) => t.label)).toEqual([
			'Requirements',
			'Diagrams',
			'Code',
			'Tests',
			'Deploy',
			'Tickets',
			'Trace'
		]);
	});

	it('enables Code, Tests, Deploy and Tickets once they are open', () => {
		for (const tab of workspaceTabs(open).filter((t) =>
			['code', 'tests', 'deploy', 'tickets'].includes(t.id)
		)) {
			expect(tab.disabled).toBeUndefined();
			expect(tab.hint).toBeUndefined();
		}
	});

	it('disables each of them with its own hint while it is closed', () => {
		const byId = Object.fromEntries(workspaceTabs(closed).map((t) => [t.id, t]));
		expect(byId.code).toMatchObject({
			disabled: true,
			hint: 'Available once the code is generated'
		});
		expect(byId.tests).toMatchObject({
			disabled: true,
			hint: 'Available once the tests are generated'
		});
		expect(byId.deploy).toMatchObject({
			disabled: true,
			hint: 'Available once the deployment is generated'
		});
		expect(byId.tickets).toMatchObject({
			disabled: true,
			hint: 'Available once the tests are approved'
		});
	});

	it('opens one tab without opening the others', () => {
		const byId = Object.fromEntries(
			workspaceTabs({ ...closed, tickets: true }).map((t) => [t.id, t])
		);
		expect(byId.tickets.disabled).toBeUndefined();
		expect(byId.code.disabled).toBe(true);
		expect(byId.tests.disabled).toBe(true);
		expect(byId.deploy.disabled).toBe(true);
	});

	it('keeps Requirements and Diagrams always open and Trace closed', () => {
		const byId = Object.fromEntries(workspaceTabs(open).map((t) => [t.id, t]));
		expect(byId.requirements.disabled).toBeUndefined();
		expect(byId.diagrams.disabled).toBeUndefined();
		expect(byId.trace.disabled).toBe(true);
	});
});

describe('activeTabId', () => {
	it('keeps the picked tab while it is open', () => {
		expect(activeTabId('diagrams', 'P4', open)).toBe('diagrams');
		expect(activeTabId('code', 'P1', open)).toBe('code');
		expect(activeTabId('tests', 'P1', open)).toBe('tests');
		expect(activeTabId('deploy', 'P1', open)).toBe('deploy');
		expect(activeTabId('tickets', 'P1', open)).toBe('tickets');
	});

	it('falls back to Requirements when the picked tab closed', () => {
		expect(activeTabId('code', 'P4', { ...open, code: false })).toBe('requirements');
		expect(activeTabId('tests', 'P5', { ...open, tests: false })).toBe('requirements');
		expect(activeTabId('deploy', 'P6', { ...open, deploy: false })).toBe('requirements');
		expect(activeTabId('tickets', 'P7', { ...open, tickets: false })).toBe('requirements');
	});

	it('follows the phase until a tab is picked', () => {
		expect(activeTabId(undefined, 'P4', open)).toBe('code');
		expect(activeTabId(undefined, 'P5', open)).toBe('tests');
		expect(activeTabId(undefined, 'P6', open)).toBe('deploy');
		expect(activeTabId(undefined, 'P7', open)).toBe('tickets');
		expect(activeTabId(undefined, 'P1', open)).toBe('requirements');
		expect(activeTabId(undefined, 'P2', open)).toBe('requirements');
	});

	it('does not default to a tab that is closed', () => {
		expect(activeTabId(undefined, 'P4', closed)).toBe('requirements');
		expect(activeTabId(undefined, 'P5', closed)).toBe('requirements');
		expect(activeTabId(undefined, 'P6', closed)).toBe('requirements');
		expect(activeTabId(undefined, 'P7', closed)).toBe('requirements');
	});
});

describe('selectedTicketId', () => {
	const t = (id: string, status = 'triaged') => ({ id, status });

	it('is the newest ticket by default', () => {
		expect(selectedTicketId([t('TCK-001'), t('TCK-002')], undefined, 2)).toBe('TCK-002');
	});

	it('prefers the ticket in progress over a newer one', () => {
		expect(selectedTicketId([t('TCK-001', 'in_progress'), t('TCK-002')], undefined, 2)).toBe(
			'TCK-001'
		);
	});

	it('keeps the ticket the developer chose', () => {
		expect(selectedTicketId([t('TCK-001'), t('TCK-002')], 'TCK-001', 2)).toBe('TCK-001');
		expect(selectedTicketId([t('TCK-001'), t('TCK-002', 'in_progress')], 'TCK-001', 2)).toBe(
			'TCK-001'
		);
	});

	it('switches to a ticket that appeared after the choice', () => {
		expect(selectedTicketId([t('TCK-001'), t('TCK-002')], 'TCK-001', 1)).toBe('TCK-002');
	});

	it('forgets a choice that no longer exists', () => {
		expect(selectedTicketId([t('TCK-002')], 'TCK-001', 1)).toBe('TCK-002');
	});

	it('is undefined without tickets', () => {
		expect(selectedTicketId([], undefined, 0)).toBeUndefined();
	});
});
