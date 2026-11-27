import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { snapshotOf } from './fixtures.ts';
import GatePanel from './GatePanel.svelte';

const failingP1 = snapshotOf({
	gates: {
		P1: {
			passed: false,
			checks: [
				{ label: 'At least one requirement', ok: true },
				{ label: 'No open questions', ok: false, detail: 'Q-001, Q-002' }
			]
		},
		P2: { passed: false, checks: [] }
	}
});

describe('GatePanel', () => {
	it('names each failing check in text and keeps Approve enabled', () => {
		render(GatePanel, { snapshot: failingP1, phase: 'P1', form: null });
		expect(screen.getByText(/No open questions:/).textContent).toContain('not met, Q-001, Q-002');
		const approve = screen.getByRole('button', { name: 'Approve' });
		expect(approve.hasAttribute('disabled')).toBe(false);
	});

	it('moves focus to the checklist when Approve is clicked with a failing gate', async () => {
		render(GatePanel, { snapshot: failingP1, phase: 'P1', form: null });
		await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
		expect(document.activeElement).toBe(
			screen.getByRole('list', { name: 'Checks before approval' })
		);
		expect(screen.getByRole('status').textContent).toContain('No open questions (Q-001, Q-002)');
	});

	it('offers Approve anyway when only open questions fail', () => {
		render(GatePanel, { snapshot: failingP1, phase: 'P1', form: null });
		expect(screen.getByRole('button', { name: 'Approve anyway' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Approve with override' })).toBeNull();
	});

	it('offers an override for a failing P2 gate once P1 is approved', () => {
		const snapshot = snapshotOf({
			state: { phases: { P1: { status: 'approved' }, P2: { status: 'awaiting_approval' } } },
			gates: {
				P1: { passed: true, checks: [] },
				P2: {
					passed: false,
					checks: [{ label: 'Every must requirement linked', ok: false, detail: 'REQ-001' }]
				}
			}
		});
		render(GatePanel, { snapshot, phase: 'P2', form: null });
		expect(screen.getByRole('button', { name: 'Approve with override' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Approve anyway' })).toBeNull();
	});

	describe('advisory checks', () => {
		const advisoryP2 = (extra: { label: string; ok: boolean; detail?: string }[] = []) =>
			snapshotOf({
				state: { phases: { P1: { status: 'approved' }, P2: { status: 'awaiting_approval' } } },
				gates: {
					P1: { passed: true, checks: [] },
					P2: {
						passed: extra.length === 0,
						checks: [
							...extra,
							{
								label: 'Acceptance criteria covered',
								ok: false,
								advisory: true,
								detail: 'REQ-002 AC3, REQ-007 AC1'
							}
						]
					}
				}
			});

		it('renders a failing advisory check as a warning, not as not met', () => {
			render(GatePanel, { snapshot: advisoryP2(), phase: 'P2', form: null });
			const text = screen.getByText(/Acceptance criteria covered:/).textContent;
			expect(text).toContain('warning, REQ-002 AC3, REQ-007 AC1');
			expect(text).not.toContain('not met');
		});

		it('offers no override for a warning alone', () => {
			render(GatePanel, { snapshot: advisoryP2(), phase: 'P2', form: null });
			expect(screen.queryByRole('button', { name: 'Approve with override' })).toBeNull();
		});

		it('keeps a failing blocking check next to a warning as not met', () => {
			const snapshot = advisoryP2([{ label: 'Design exists', ok: false }]);
			render(GatePanel, { snapshot, phase: 'P2', form: null });
			expect(screen.getByText(/Design exists:/).textContent).toContain('not met');
			expect(screen.getByRole('button', { name: 'Approve with override' })).toBeTruthy();
		});
	});

	it('shows Approve busy with an explanation while a run is active', () => {
		const snapshot = snapshotOf({ activeRun: { runId: 'r', phase: 'P1' } });
		render(GatePanel, { snapshot, phase: 'P1', form: null });
		expect(screen.getByRole('button', { name: 'Approve' }).getAttribute('aria-busy')).toBe('true');
		expect(screen.getByText(/The agent is working/)).toBeTruthy();
	});

	it('shows the error of a rejected approve next to the gate', () => {
		render(GatePanel, {
			snapshot: snapshotOf(),
			phase: 'P1',
			form: { action: 'approve', message: 'The agent is still working on this project.' }
		});
		expect(screen.getByRole('alert').textContent).toContain('still working');
	});

	it('has one Discard last run entry that opens the named confirmation', async () => {
		const snapshot = snapshotOf({
			lastRun: { id: 'x', phase: 'P1', status: 'failed', error: 'boom' },
			discardableRun: { id: 'x', phase: 'P1', status: 'failed', error: 'boom' }
		});
		render(GatePanel, { snapshot, phase: 'P1', form: null });
		await userEvent.click(screen.getByRole('button', { name: 'Discard last run' }));
		expect(screen.getByRole('button', { name: 'Discard run' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Keep run' })).toBeTruthy();
	});

	it('tells the developer to approve the requirements first when a stale design waits on them', () => {
		const snapshot = snapshotOf({
			state: { phases: { P1: { status: 'awaiting_approval' }, P2: { status: 'stale' } } },
			gates: { P1: { passed: true, checks: [] }, P2: { passed: true, checks: [] } }
		});
		render(GatePanel, { snapshot, phase: 'P2', form: null });
		expect(
			screen.getByText(/Approve the requirements first, then choose Update or Still valid/)
		).toBeTruthy();
		expect(screen.queryByText(/Use the banner above/)).toBeNull();
	});
});

const p4State = {
	phases: {
		P1: { status: 'approved' },
		P2: { status: 'approved' },
		P4: { status: 'awaiting_approval' }
	}
};
const checksOf = (over: Record<string, unknown> = {}) => ({
	at: '2026-11-20T10:00:00Z',
	codeHash: 'h',
	typecheck: {
		ok: false,
		timedOut: false,
		errors: [{ file: 'src/tasks/Task.ts', line: 12, col: 3, message: 'Type string is not number' }]
	},
	drift: [
		{
			kind: 'changed',
			id: 'DSN-002',
			name: 'TaskList',
			file: 'src/tasks/TaskList.ts',
			line: 4,
			details: ['method add differs']
		},
		{ kind: 'missing_in_code', id: 'DSN-003', name: 'Tag', details: ['no class Tag in src/'] }
	],
	...over
});
const p4Gate = (checks: { label: string; ok: boolean; detail?: string }[]) => ({
	P1: { passed: true, checks: [] },
	P2: { passed: true, checks: [] },
	P4: { passed: checks.every((c) => c.ok), checks }
});
const failingP4 = snapshotOf({
	state: p4State,
	files: ['src/tasks/Task.ts', 'src/tasks/TaskList.ts'],
	checks: checksOf(),
	gates: p4Gate([
		{ label: 'Code exists', ok: true },
		{ label: 'Typecheck passes', ok: false, detail: '1 error' },
		{ label: 'Code matches the design', ok: false, detail: '2 differences' }
	])
});

describe('GatePanel for P4', () => {
	it('shows the three checks and opens a tsc error or drift item at its line', async () => {
		const onopenfile = vi.fn();
		render(GatePanel, { snapshot: failingP4, phase: 'P4', form: null, onopenfile });
		expect(screen.getByText(/Code exists:/)).toBeTruthy();
		expect(screen.getByText(/Typecheck passes:/).textContent).toContain('not met, 1 error');
		expect(screen.getByText(/Code matches the design:/).textContent).toContain('2 differences');
		await userEvent.click(screen.getByRole('button', { name: /src\/tasks\/Task\.ts:12/ }));
		expect(onopenfile).toHaveBeenLastCalledWith({ path: 'src/tasks/Task.ts', line: 12 });
		await userEvent.click(screen.getByRole('button', { name: /TaskList/ }));
		expect(onopenfile).toHaveBeenLastCalledWith({ path: 'src/tasks/TaskList.ts', line: 4 });
	});

	it('has no Check again button while only the scaffold exists', () => {
		const snapshot = snapshotOf({
			state: p4State,
			files: ['package.json', 'tsconfig.json'],
			gates: p4Gate([{ label: 'Code exists', ok: false }])
		});
		render(GatePanel, { snapshot, phase: 'P4', form: null });
		expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
	});

	it('lists a drift item without a file as text, not a button', () => {
		render(GatePanel, { snapshot: failingP4, phase: 'P4', form: null });
		expect(screen.getByText('Tag').closest('button')).toBeNull();
	});

	it('shows out of date and no items when the code changed since the checks', () => {
		const snapshot = snapshotOf({
			state: p4State,
			files: ['src/tasks/Task.ts'],
			checks: checksOf(),
			gates: p4Gate([
				{ label: 'Code exists', ok: true },
				{ label: 'Typecheck passes', ok: false, detail: 'out of date' },
				{ label: 'Code matches the design', ok: false, detail: 'out of date' }
			])
		});
		render(GatePanel, { snapshot, phase: 'P4', form: null });
		expect(screen.getAllByText(/out of date/)).toHaveLength(2);
		expect(screen.queryByRole('button', { name: /Task\.ts:12/ })).toBeNull();
	});

	it('has a Check again button that submits the checkCode action', () => {
		render(GatePanel, { snapshot: failingP4, phase: 'P4', form: null });
		const button = screen.getByRole('button', { name: 'Check again' });
		expect(button.closest('form')?.getAttribute('action')).toBe('?/checkCode');
	});

	it('offers Approve with override over failing checks and keeps Approve enabled', () => {
		render(GatePanel, { snapshot: failingP4, phase: 'P4', form: null });
		expect(screen.getByRole('button', { name: 'Approve with override' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Approve' }).hasAttribute('disabled')).toBe(false);
	});

	it('asks for the design approval first when P2 is not approved', () => {
		const snapshot = snapshotOf({
			state: { phases: { ...p4State.phases, P2: { status: 'awaiting_approval' } } },
			gates: p4Gate([{ label: 'Code exists', ok: false }])
		});
		render(GatePanel, { snapshot, phase: 'P4', form: null });
		expect(screen.getByText(/Approve the design first/)).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Approve with override' })).toBeNull();
	});
});

const p5State = {
	phases: {
		P1: { status: 'approved' },
		P2: { status: 'approved' },
		P4: { status: 'approved' },
		P5: { status: 'awaiting_approval' }
	}
};
const p5Checks = (over: Record<string, unknown> = {}) => ({
	at: '2026-11-20T10:00:00Z',
	codeHash: 'h',
	testHash: 't',
	typecheck: {
		ok: false,
		timedOut: false,
		errors: [
			{ file: 'test/UC-001.test.ts', line: 3, col: 1, message: 'Cannot find name x' },
			{ file: 'src/tasks/Task.ts', line: 9, col: 1, message: 'Not a test error' }
		]
	},
	result: {
		ok: false,
		passed: 1,
		failed: 1,
		timedOut: false,
		logTail: '',
		tests: [
			{
				name: 'UC-001 Add REQ-001 AC2: rejects',
				title: 'REQ-001 AC2: rejects',
				file: 'test/UC-001.test.ts',
				status: 'failed',
				line: 12,
				error: 'expected 400 to be 201\n  at x'
			},
			{
				name: 'UC-001 Add REQ-001 AC1: adds',
				title: 'REQ-001 AC1: adds',
				file: 'test/UC-001.test.ts',
				status: 'passed',
				line: 5
			}
		]
	},
	findings: [],
	testFixes: [],
	...over
});
const p5Gate = (checks: { label: string; ok: boolean; detail?: string }[]) => ({
	P1: { passed: true, checks: [] },
	P2: { passed: true, checks: [] },
	P4: { passed: true, checks: [] },
	P5: { passed: checks.every((c) => c.ok), checks }
});
const failingP5 = snapshotOf({
	state: p5State,
	files: ['src/A.ts', 'test/UC-001.test.ts'],
	testChecks: p5Checks(),
	gates: p5Gate([
		{ label: 'Tests exist', ok: true },
		{ label: 'Tests type check', ok: false, detail: '1 error' },
		{ label: 'All tests pass', ok: false, detail: '1 failed' }
	])
});

describe('GatePanel for P5', () => {
	it('is titled for the tests and approves with phase P5', () => {
		render(GatePanel, { snapshot: failingP5, phase: 'P5', form: null });
		expect(screen.getByRole('heading', { name: 'Approve the tests' })).toBeTruthy();
		const form = screen.getByRole('button', { name: 'Approve' }).closest('form')!;
		expect(form.querySelector<HTMLInputElement>('input[name="phase"]')?.value).toBe('P5');
	});

	it('opens a test type error or a failing test at its line, and skips errors outside test/', async () => {
		const onopenfile = vi.fn();
		render(GatePanel, { snapshot: failingP5, phase: 'P5', form: null, onopenfile });
		expect(screen.queryByRole('button', { name: /src\/tasks\/Task\.ts/ })).toBeNull();
		await userEvent.click(screen.getByRole('button', { name: /test\/UC-001\.test\.ts:3/ }));
		expect(onopenfile).toHaveBeenLastCalledWith({ path: 'test/UC-001.test.ts', line: 3 });
		await userEvent.click(screen.getByRole('button', { name: /REQ-001 AC2: rejects/ }));
		expect(onopenfile).toHaveBeenLastCalledWith({ path: 'test/UC-001.test.ts', line: 12 });
	});

	it('lists a test type error under any spelling of test/ and a global error, but not src/', async () => {
		const onopenfile = vi.fn();
		const snapshot = snapshotOf({
			state: p5State,
			files: ['test/a.test.ts'],
			testChecks: p5Checks({
				typecheck: {
					ok: false,
					timedOut: false,
					errors: [
						{ file: './test/a.test.ts', line: 2, col: 1, message: 'dot slash' },
						{ file: 'test\\b.test.ts', line: 3, col: 1, message: 'backslash' },
						{ file: '', line: 0, col: 0, message: 'TS18003: no inputs' },
						{ file: 'src/x.ts', line: 1, col: 1, message: 'not a test error' }
					]
				}
			}),
			gates: p5Gate([{ label: 'Tests type check', ok: false, detail: '3 errors' }])
		});
		render(GatePanel, { snapshot, phase: 'P5', form: null, onopenfile });
		const list = screen.getByRole('list', { name: 'Tests type check, details' });
		expect(list.textContent).toContain('dot slash');
		expect(list.textContent).toContain('backslash');
		expect(list.textContent).toContain('TS18003: no inputs');
		expect(list.textContent).not.toContain('not a test error');
		await userEvent.click(screen.getByRole('button', { name: /dot slash/ }));
		expect(onopenfile).toHaveBeenLastCalledWith({ path: 'test/a.test.ts', line: 2 });
		await userEvent.click(screen.getByRole('button', { name: /backslash/ }));
		expect(onopenfile).toHaveBeenLastCalledWith({ path: 'test/b.test.ts', line: 3 });
		// The global error has no file to open: text, not a button.
		expect(screen.queryByRole('button', { name: /no inputs/ })).toBeNull();
	});

	it('shows a rejected checkTests once, in the gate', () => {
		render(GatePanel, {
			snapshot: failingP5,
			phase: 'P5',
			form: { action: 'checkTests', message: 'Docker is not running.' }
		});
		expect(screen.getAllByRole('alert')).toHaveLength(1);
		expect(screen.getByRole('alert').textContent).toContain('Docker is not running.');
	});

	it('shows no items while the checks are out of date', () => {
		const snapshot = snapshotOf({
			state: p5State,
			files: ['test/UC-001.test.ts'],
			testChecks: p5Checks(),
			gates: p5Gate([
				{ label: 'Tests type check', ok: false, detail: 'out of date' },
				{ label: 'All tests pass', ok: false, detail: 'out of date' }
			])
		});
		render(GatePanel, { snapshot, phase: 'P5', form: null, onopenfile: () => {} });
		expect(screen.queryByRole('button', { name: /UC-001\.test\.ts/ })).toBeNull();
	});

	it('has a Check again button that submits checkTests once tests exist', () => {
		render(GatePanel, { snapshot: failingP5, phase: 'P5', form: null });
		const check = screen.getByRole('button', { name: 'Check again' });
		expect(check.closest('form')?.getAttribute('action')).toBe('?/checkTests');
	});

	it('has no Check again button without tests', () => {
		render(GatePanel, {
			snapshot: snapshotOf({ state: p5State, files: ['src/A.ts'] }),
			phase: 'P5',
			form: null
		});
		expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
	});

	it('asks for the code approval first when P4 is not approved', () => {
		const snapshot = snapshotOf({
			state: { phases: { ...p5State.phases, P4: { status: 'awaiting_approval' } } },
			gates: p5Gate([{ label: 'Tests exist', ok: false }])
		});
		render(GatePanel, { snapshot, phase: 'P5', form: null });
		expect(screen.getByText(/Approve the code first/)).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Approve with override' })).toBeNull();
	});

	it('offers Approve with override over failing checks', () => {
		render(GatePanel, { snapshot: failingP5, phase: 'P5', form: null });
		expect(screen.getByRole('button', { name: 'Approve with override' })).toBeTruthy();
	});
});

const p6State = {
	phases: {
		P1: { status: 'approved' },
		P2: { status: 'approved' },
		P4: { status: 'approved' },
		P5: { status: 'approved' },
		P6: { status: 'awaiting_approval' }
	}
};
const p6Gate = (checks: { label: string; ok: boolean; detail?: string }[]) => ({
	P1: { passed: true, checks: [] },
	P2: { passed: true, checks: [] },
	P4: { passed: true, checks: [] },
	P5: { passed: true, checks: [] },
	P6: { passed: checks.every((c) => c.ok), checks }
});
const failingP6 = snapshotOf({
	state: p6State,
	files: ['src/A.ts', 'Dockerfile', 'compose.yaml', 'RUN.md'],
	gates: p6Gate([
		{ label: 'Deployment files exist', ok: true },
		{ label: 'Consistent with the design', ok: true },
		{ label: 'Deploy check passed', ok: false, detail: 'live-update-server no answer' }
	])
});

describe('GatePanel for P6', () => {
	it('is titled for the deployment, names the failing service and approves with phase P6', () => {
		render(GatePanel, { snapshot: failingP6, phase: 'P6', form: null });
		expect(screen.getByRole('heading', { name: 'Approve the deployment' })).toBeTruthy();
		expect(screen.getByText(/live-update-server no answer/)).toBeTruthy();
		const form = screen.getByRole('button', { name: 'Approve' }).closest('form')!;
		expect(form.querySelector<HTMLInputElement>('input[name="phase"]')?.value).toBe('P6');
	});

	it('has a Check again button that submits checkDeploy once deploy files exist', () => {
		render(GatePanel, { snapshot: failingP6, phase: 'P6', form: null });
		const check = screen.getByRole('button', { name: 'Check again' });
		expect(check.closest('form')?.getAttribute('action')).toBe('?/checkDeploy');
	});

	it('has no Check again button without deploy files', () => {
		render(GatePanel, {
			snapshot: snapshotOf({ state: p6State, files: ['src/A.ts'] }),
			phase: 'P6',
			form: null
		});
		expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
	});

	it('shows the message of a failed check once, here', () => {
		render(GatePanel, {
			snapshot: failingP6,
			phase: 'P6',
			form: { action: 'checkDeploy', message: 'Docker is not running' }
		});
		expect(screen.getAllByText(/Docker is not running/)).toHaveLength(1);
		expect(screen.getByRole('alert')).toBeTruthy();
	});

	it('shows a failed deploy check in any phase, so the Deploy tab needs no banner of its own', () => {
		render(GatePanel, {
			snapshot: failingP5,
			phase: 'P5',
			form: { action: 'checkDeploy', message: 'Docker is not running' }
		});
		expect(screen.getAllByText(/Docker is not running/)).toHaveLength(1);
	});

	it('asks for the test approval first when P5 is not approved', () => {
		const snapshot = snapshotOf({
			state: { phases: { ...p6State.phases, P5: { status: 'awaiting_approval' } } },
			gates: p6Gate([{ label: 'Deployment files exist', ok: false }])
		});
		render(GatePanel, { snapshot, phase: 'P6', form: null });
		expect(screen.getByText(/Approve the tests first/)).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Approve with override' })).toBeNull();
	});

	it('offers Approve with override over failing checks', () => {
		render(GatePanel, { snapshot: failingP6, phase: 'P6', form: null });
		expect(screen.getByRole('button', { name: 'Approve with override' })).toBeTruthy();
	});

	it('points a stale P6 to the banner', () => {
		const snapshot = snapshotOf({
			state: { phases: { ...p6State.phases, P6: { status: 'stale' } } },
			gates: p6Gate([{ label: 'Deployment files exist', ok: true }])
		});
		render(GatePanel, { snapshot, phase: 'P6', form: null });
		expect(screen.getByText(/start scripts or dependencies changed after approval/)).toBeTruthy();
	});
});

describe('GatePanel drift ticket', () => {
	const p4 = (over: Record<string, unknown> = {}) =>
		snapshotOf({
			state: {
				phases: {
					P1: { status: 'approved' },
					P2: { status: 'approved' },
					P4: { status: 'awaiting_approval' },
					P5: { status: 'not_started' }
				}
			},
			files: ['src/a.ts'],
			...over
		});

	it('shows Open drift ticket in the P4 gate when a drift ticket can be opened', () => {
		render(GatePanel, { snapshot: p4({ canOpenDriftTicket: true }), phase: 'P4', form: null });
		const button = screen.getByRole('button', { name: 'Open drift ticket' });
		expect(button.closest('form')?.getAttribute('action')).toBe('?/openDriftTicket');
	});

	it('hides it when no drift ticket can be opened', () => {
		render(GatePanel, { snapshot: p4({ canOpenDriftTicket: false }), phase: 'P4', form: null });
		expect(screen.queryByRole('button', { name: 'Open drift ticket' })).toBeNull();
	});

	it('shows it in no other gate', () => {
		render(GatePanel, { snapshot: p4({ canOpenDriftTicket: true }), phase: 'P2', form: null });
		expect(screen.queryByRole('button', { name: 'Open drift ticket' })).toBeNull();
	});

	it('shows a refused drift ticket as an error', () => {
		render(GatePanel, {
			snapshot: p4({ canOpenDriftTicket: true }),
			phase: 'P4',
			form: { action: 'openDriftTicket', message: 'A drift ticket is already open.' }
		});
		expect(screen.getByText('A drift ticket is already open.')).toBeTruthy();
	});
});
