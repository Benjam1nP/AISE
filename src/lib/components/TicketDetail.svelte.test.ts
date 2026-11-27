import { render, screen, waitFor, within } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { captureSubmit, snapshotOf, ticketOf } from './fixtures.ts';
import TicketDetail from './TicketDetail.svelte';

type Over = Record<string, unknown>;
const props = (ticket = ticketOf(), over: Over = {}) => ({
	snapshot: snapshotOf({ tickets: [ticket] }),
	ticket,
	form: null,
	onopenid: vi.fn(),
	onopenfile: vi.fn(),
	onselectphase: vi.fn(),
	...over
});
const formOf = (button: HTMLElement) => button.closest('form')!;
const stale = (check: string) => ({ label: check, ok: false, detail: 'out of date' });
const gatesWith = (p4: object[], p5: object[]) => ({
	P1: { passed: true, checks: [] },
	P2: { passed: true, checks: [] },
	P4: { passed: p4.length === 0, checks: p4 },
	P5: { passed: p5.length === 0, checks: p5 }
});
const walkOf = (...rows: [string, string][]) =>
	rows.map(([phase, status], i) => ({ phase, status, entry: i === 0 }));
/** P1 and P2 approved, P4 stale: the first row that Update and Still valid can act on. */
const staleP4 = (over: Over = {}) =>
	inProgress({ steps: walkOf(['P1', 'approved'], ['P2', 'approved'], ['P4', 'stale']), ...over });

const inProgress = (over: Over = {}) =>
	ticketOf({
		status: 'in_progress',
		entryRan: true,
		steps: [
			{ phase: 'P1', status: 'approved', entry: true },
			{ phase: 'P2', status: 'awaiting_approval', entry: false },
			{ phase: 'P4', status: 'stale', entry: false }
		],
		closeBlocked: 'P2 is awaiting approval; approve it before closing the ticket',
		...over
	});

describe('TicketDetail header', () => {
	it('shows ID, kind, title, status and the description', () => {
		render(TicketDetail, props());
		const head = screen.getByRole('heading', { name: 'Tasks need a due date' }).closest('header')!;
		expect(head.textContent).toContain('TCK-001');
		expect(head.textContent).toContain('Change request');
		expect(head.textContent).toContain('Triaged');
		expect(screen.getByRole('heading', { name: 'Tasks need a due date' })).toBeTruthy();
		expect(screen.getByText('Add a due date to every task.')).toBeTruthy();
	});

	it('renders the description and title as text, never as HTML or Markdown', () => {
		const t = ticketOf({
			title: '<b>bold</b> title',
			description: '<img src=x onerror=alert(1)> and **not bold**'
		});
		const { container } = render(TicketDetail, props(t));
		expect(container.querySelector('img')).toBeNull();
		expect(container.querySelector('b')).toBeNull();
		expect(screen.getByText('<img src=x onerror=alert(1)> and **not bold**')).toBeTruthy();
		expect(screen.getByRole('heading', { name: '<b>bold</b> title' })).toBeTruthy();
	});

	it('does not embed the ticket chat: the page shows it beside the artefacts', () => {
		const t = ticketOf({
			chat: [
				{ role: 'assistant', text: 'Which tasks need a due date?', at: '2026-11-22T10:00:00Z' }
			]
		});
		render(TicketDetail, props(t));
		expect(screen.queryByRole('heading', { name: 'Chat with the maintenance agent' })).toBeNull();
		expect(screen.queryByText('Which tasks need a due date?')).toBeNull();
		expect(screen.queryByRole('textbox')).toBeNull();
	});
});

describe('TicketDetail triaged', () => {
	it('shows the entry phase, the steps, the affected IDs and the files', () => {
		render(TicketDetail, props());
		expect(screen.getByText(/Starts in P1 Requirements/)).toBeTruthy();
		const steps = screen.getByRole('list', { name: 'Plan steps' });
		expect(
			within(steps)
				.getAllByRole('listitem')
				.map((li) => li.textContent)
		).toEqual(['Add a requirement for the due date', 'Show the due date in the design']);
		expect(screen.getByRole('button', { name: 'REQ-001' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'src/tasks/Task.ts' })).toBeTruthy();
	});

	it('opens an affected ID and a file through the callbacks', async () => {
		const p = props();
		render(TicketDetail, p);
		await userEvent.click(screen.getByRole('button', { name: 'REQ-001' }));
		await userEvent.click(screen.getByRole('button', { name: 'src/tasks/Task.ts' }));
		expect(p.onopenid).toHaveBeenCalledWith('REQ-001');
		expect(p.onopenfile).toHaveBeenCalledWith({ path: 'src/tasks/Task.ts' });
	});

	it('has an Approve plan form and a Reject form, both with the ticket ID', async () => {
		const { container } = render(TicketDetail, props());
		const approve = screen.getByRole('button', { name: 'Approve plan' });
		const reject = screen.getByRole('button', { name: 'Reject' });
		expect(formOf(approve).getAttribute('action')).toBe('?/approvePlan');
		expect(formOf(reject).getAttribute('action')).toBe('?/rejectTicket');
		const sent = captureSubmit(formOf(approve));
		await userEvent.click(approve);
		expect(sent()).toEqual({ ticketId: 'TCK-001' });
		expect(container.querySelector('select[name="direction"]')).toBeNull();
	});

	it('Reject posts the ticket ID', async () => {
		render(TicketDetail, props());
		const reject = screen.getByRole('button', { name: 'Reject' });
		const sent = captureSubmit(formOf(reject));
		await userEvent.click(reject);
		expect(sent()).toEqual({ ticketId: 'TCK-001' });
	});

	it('shows Approve plan busy with a reason while an agent runs, and does not submit (R17)', async () => {
		const t = ticketOf();
		const p = props(t, {
			snapshot: snapshotOf({ tickets: [t], activeRun: { runId: 'r', phase: 'P5' } })
		});
		render(TicketDetail, p);
		const button = screen.getByRole('button', { name: 'Approve plan' });
		const sent = captureSubmit(formOf(button));
		expect(button.getAttribute('aria-busy')).toBe('true');
		expect(button.hasAttribute('disabled')).toBe(false);
		const note = screen.getByText(/available when the agent finishes/);
		expect(button.getAttribute('aria-describedby')).toBe(note.id);
		await userEvent.click(button);
		expect(sent()).toBeUndefined();
	});

	it('offers the direction of a drift ticket, preset from the plan, and posts it', async () => {
		const t = ticketOf({
			kind: 'drift',
			plan: {
				entry: 'P4',
				affectedIds: [],
				files: [],
				steps: ['Restore the code'],
				direction: 'code'
			}
		});
		render(TicketDetail, props(t));
		const select = screen.getByLabelText('Direction') as HTMLSelectElement;
		expect(select.value).toBe('code');
		expect([...select.options].map((o) => o.textContent)).toEqual([
			'The design follows the code (P2)',
			'The code follows the design (P4)'
		]);
		await userEvent.selectOptions(select, 'design');
		const button = screen.getByRole('button', { name: 'Approve plan' });
		const sent = captureSubmit(formOf(button));
		await userEvent.click(button);
		expect(sent()).toEqual({ ticketId: 'TCK-001', direction: 'design' });
	});

	it('presets the drift direction from the entry phase when the plan names none', () => {
		const t = ticketOf({
			kind: 'drift',
			plan: { entry: 'P4', affectedIds: [], files: [], steps: ['Restore the code'] }
		});
		render(TicketDetail, props(t));
		expect((screen.getByLabelText('Direction') as HTMLSelectElement).value).toBe('code');
	});

	it('shows the server refusal of Approve plan next to the buttons and Dismiss hides it', async () => {
		const message = 'P1 is stale; update it or confirm it is still valid before approving the plan';
		const { rerender } = render(TicketDetail, props());
		await rerender(props(ticketOf(), { form: { action: 'approvePlan', message } }));
		expect(screen.getByRole('alert').textContent).toContain(message);
		await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
		expect(screen.queryByRole('alert')).toBeNull();
	});

	it('does not show an error that was there when the ticket opened (it may belong to another ticket)', async () => {
		const old = { action: 'approvePlan', message: 'Belongs to TCK-009.' };
		const { rerender } = render(TicketDetail, props(ticketOf(), { form: old }));
		expect(screen.queryByRole('alert')).toBeNull();
		await rerender(props(ticketOf(), { form: { ...old, message: 'A new refusal.' } }));
		expect(screen.getByRole('alert').textContent).toContain('A new refusal.');
	});
});

describe('TicketDetail open and finished', () => {
	it('an open ticket waits for the answers, can be rejected and cannot be approved', () => {
		render(TicketDetail, props(ticketOf({ status: 'open', plan: undefined })));
		expect(screen.getByText(/answer its questions/)).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Approve plan' })).toBeNull();
		expect(formOf(screen.getByRole('button', { name: 'Reject' })).getAttribute('action')).toBe(
			'?/rejectTicket'
		);
	});

	it('a rejected ticket has no actions', () => {
		render(TicketDetail, props(ticketOf({ status: 'rejected' })));
		expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Approve plan' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Close ticket' })).toBeNull();
	});
});

describe('TicketDetail in progress', () => {
	const walk = () => screen.getByRole('list', { name: 'Walk' });

	it('lists the phases of the walk with name, status and the entry mark', () => {
		render(TicketDetail, props(inProgress()));
		const items = within(walk()).getAllByRole('listitem');
		expect(items).toHaveLength(3);
		expect(items[0].textContent).toContain('P1');
		expect(items[0].textContent).toContain('Requirements');
		expect(items[0].textContent).toContain('Approved');
		expect(items[0].textContent).toContain('Entry phase');
		expect(items[1].textContent).toContain('Awaiting approval');
		expect(items[1].textContent).not.toContain('Entry phase');
		expect(items[2].textContent).toContain('Stale');
	});

	it('a stale step offers Update and Still valid for its phase', async () => {
		render(TicketDetail, props(staleP4()));
		const item = within(walk()).getAllByRole('listitem')[2];
		const update = within(item).getByRole('button', { name: 'Update' });
		const valid = within(item).getByRole('button', { name: 'Still valid' });
		expect(formOf(update).getAttribute('action')).toBe('?/update');
		expect(formOf(valid).getAttribute('action')).toBe('?/stillValid');
		const sent = captureSubmit(formOf(update));
		await userEvent.click(update);
		expect(sent()).toEqual({ phase: 'P4' });
		const sentValid = captureSubmit(formOf(valid));
		await userEvent.click(valid);
		expect(sentValid()).toEqual({ phase: 'P4' });
	});

	it('a stale step also opens its phase', async () => {
		const p = props(staleP4());
		render(TicketDetail, p);
		const item = within(walk()).getAllByRole('listitem')[2];
		await userEvent.click(within(item).getByRole('button', { name: 'Open P4' }));
		expect(p.onselectphase).toHaveBeenCalledWith('P4');
	});

	it('a row behind a phase that awaits approval says to approve it first and has no Update or Still valid', async () => {
		const p = props(inProgress());
		render(TicketDetail, p);
		const items = within(walk()).getAllByRole('listitem');
		expect(items[2].textContent).toContain('Approve P2 first.');
		expect(within(items[2]).queryByRole('button', { name: 'Update' })).toBeNull();
		expect(within(items[2]).queryByRole('button', { name: 'Still valid' })).toBeNull();
		// The blocking row keeps its own action, and the stale row can still be opened.
		expect(within(items[1]).getByRole('button', { name: 'Review in P2' })).toBeTruthy();
		await userEvent.click(within(items[2]).getByRole('button', { name: 'Open P4' }));
		expect(p.onselectphase).toHaveBeenCalledWith('P4');
	});

	it('a row behind a stale phase says to update that phase first', () => {
		const t = inProgress({ steps: walkOf(['P1', 'approved'], ['P2', 'stale'], ['P4', 'stale']) });
		render(TicketDetail, props(t));
		const items = within(walk()).getAllByRole('listitem');
		expect(items[2].textContent).toContain('Update P2 or confirm it is still valid first.');
		expect(within(items[2]).queryByRole('button', { name: 'Update' })).toBeNull();
		expect(within(items[1]).getByRole('button', { name: 'Update' })).toBeTruthy();
		expect(items[1].textContent).not.toContain('first.');
	});

	it('a stale P4 whose checks are out of date says to check again before Still valid', () => {
		const t = staleP4();
		const snapshot = snapshotOf({
			tickets: [t],
			gates: gatesWith([stale('Code type checks')], [])
		});
		render(TicketDetail, props(t, { snapshot }));
		const item = within(walk()).getAllByRole('listitem')[2];
		expect(item.textContent).toContain('Open P4 and press Check again, then Still valid.');
		expect(within(item).getByRole('button', { name: 'Still valid' })).toBeTruthy();
	});

	it('a stale P4 with current checks does not ask for a new check', () => {
		render(TicketDetail, props(staleP4()));
		const item = within(walk()).getAllByRole('listitem')[2];
		expect(item.textContent).not.toContain('Check again');
	});

	it('an approved step has no action', () => {
		render(TicketDetail, props(inProgress()));
		const item = within(walk()).getAllByRole('listitem')[0];
		expect(within(item).queryByRole('button')).toBeNull();
	});

	it('an awaiting step sends the developer to the phase', async () => {
		const p = props(inProgress());
		render(TicketDetail, p);
		const item = within(walk()).getAllByRole('listitem')[1];
		await userEvent.click(within(item).getByRole('button', { name: 'Review in P2' }));
		expect(p.onselectphase).toHaveBeenCalledWith('P2');
	});

	it('Update and Still valid are busy with a reason while an agent runs, never disabled (R17)', async () => {
		const t = staleP4();
		render(
			TicketDetail,
			props(t, { snapshot: snapshotOf({ tickets: [t], activeRun: { runId: 'r', phase: 'P4' } }) })
		);
		const note = screen.getByText(/available when the agent finishes/);
		for (const name of ['Update', 'Still valid']) {
			const button = within(walk()).getByRole('button', { name });
			expect(button.getAttribute('aria-busy')).toBe('true');
			expect(button.hasAttribute('disabled')).toBe(false);
			expect(button.getAttribute('aria-describedby')).toContain(note.id);
		}
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		await userEvent.click(within(walk()).getByRole('button', { name: 'Still valid' }));
		expect(fetchMock).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});

	it('Close ticket names why it cannot close, stays enabled, sends nothing and moves focus to the reason', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		render(TicketDetail, props(inProgress()));
		const button = screen.getByRole('button', { name: 'Close ticket' });
		expect(button.hasAttribute('disabled')).toBe(false);
		const reason = screen.getByText(/P2 is awaiting approval/);
		expect(button.getAttribute('aria-describedby')).toBe(reason.id);
		await userEvent.click(button);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(document.activeElement).toBe(reason);
		vi.unstubAllGlobals();
	});

	it('offers Start the entry run again while the entry run has not finished, and posts the ticket', async () => {
		render(TicketDetail, props(inProgress({ entryRan: false })));
		const button = screen.getByRole('button', { name: 'Start the entry run again' });
		expect(formOf(button).getAttribute('action')).toBe('?/approvePlan');
		const sent = captureSubmit(formOf(button));
		await userEvent.click(button);
		expect(sent()).toEqual({ ticketId: 'TCK-001' });
	});

	it('shows the server refusal of Start the entry run again', async () => {
		const t = inProgress({ entryRan: false });
		const { rerender } = render(TicketDetail, props(t));
		await rerender(props(t, { form: { action: 'approvePlan', message: 'P1 is running' } }));
		expect(screen.getByRole('alert').textContent).toContain('P1 is running');
	});

	it('has no Start the entry run again once the entry run finished', () => {
		render(TicketDetail, props(inProgress()));
		expect(screen.queryByRole('button', { name: 'Start the entry run again' })).toBeNull();
	});

	it('Close ticket posts the ticket when nothing blocks it', async () => {
		render(TicketDetail, props(inProgress({ closeBlocked: null })));
		const button = screen.getByRole('button', { name: 'Close ticket' });
		expect(formOf(button).getAttribute('action')).toBe('?/closeTicket');
		expect(button.getAttribute('aria-describedby')).toBeNull();
		const sent = captureSubmit(formOf(button));
		await userEvent.click(button);
		expect(sent()).toEqual({ ticketId: 'TCK-001' });
	});

	it('names the P5 check to run in the Tests tab before closing a ticket that walks through P5', () => {
		const t = inProgress({
			closeBlocked: null,
			steps: walkOf(['P1', 'approved'], ['P5', 'approved'])
		});
		const snapshot = snapshotOf({
			tickets: [t],
			gates: gatesWith([], [stale('All tests pass')])
		});
		render(TicketDetail, props(t, { snapshot }));
		expect(screen.getByText('Run the tests in the Tests tab before closing.')).toBeTruthy();
		// A hint, not a block: Close ticket is not described as blocked.
		expect(
			screen.getByRole('button', { name: 'Close ticket' }).getAttribute('aria-describedby')
		).toBeNull();
	});

	it.each([
		['the walk has no P5 row', walkOf(['P1', 'approved'], ['P2', 'approved']), true],
		['the test results are current', walkOf(['P1', 'approved'], ['P5', 'approved']), false]
	])('has no test hint when %s', (_why, steps, outOfDate) => {
		const t = inProgress({ closeBlocked: null, steps });
		const snapshot = snapshotOf({
			tickets: [t],
			gates: gatesWith([], outOfDate ? [stale('All tests pass')] : [])
		});
		render(TicketDetail, props(t, { snapshot }));
		expect(screen.queryByText(/Run the tests in the Tests tab/)).toBeNull();
	});

	it('shows the server refusal of Close ticket', async () => {
		const message = 'P4 is stale; update it or confirm it is still valid before closing the ticket';
		const { rerender } = render(TicketDetail, props(inProgress()));
		await rerender(props(inProgress(), { form: { action: 'closeTicket', message } }));
		expect(screen.getByRole('alert').textContent).toContain(message);
	});

	it('shows Not reproduced for a bug whose test passes at once', () => {
		render(TicketDetail, props(inProgress({ kind: 'bug', notReproduced: true })));
		expect(screen.getByText('Not reproduced')).toBeTruthy();
	});

	it('shows no Not reproduced banner otherwise', () => {
		render(TicketDetail, props(inProgress()));
		expect(screen.queryByText('Not reproduced')).toBeNull();
	});
});

describe('TicketDetail done', () => {
	const done = () =>
		ticketOf({
			status: 'done',
			report: {
				at: '2026-11-22T12:00:00.000Z',
				text: 'The due date is **stored** and shown.',
				steps: [
					{
						runId: 'r1',
						phase: 'P1',
						agent: 'requirements',
						status: 'done',
						summary: 'Added REQ-009 for the due date',
						files: []
					},
					{
						runId: 'r2',
						phase: 'P4',
						agent: 'code',
						status: 'done',
						summary: 'Added dueDate to Task',
						files: ['src/tasks/Task.ts']
					}
				],
				changedIds: ['REQ-009'],
				files: [{ path: 'src/tasks/Task.ts', diff: '-id: number\n+dueDate: string' }],
				tests: { at: '2026-11-22T11:00:00.000Z', passed: 7, failed: 1, outOfDate: true }
			}
		});

	it('shows the report text as formatted text and the steps with their summaries', () => {
		render(TicketDetail, props(done()));
		expect(screen.getByText('stored').tagName).toBe('STRONG');
		const steps = screen.getByRole('list', { name: 'Steps of the change' });
		const items = within(steps).getAllByRole('listitem');
		expect(items[0].textContent).toContain('P1');
		expect(items[0].textContent).toContain('Added REQ-009 for the due date');
		expect(items[1].textContent).toContain('Added dueDate to Task');
		expect(items[1].textContent).toContain('src/tasks/Task.ts');
	});

	it('does not turn report text into HTML', () => {
		const t = done();
		t.report!.text = '<img src=x onerror=alert(1)>';
		const { container } = render(TicketDetail, props(t));
		expect(container.querySelector('img')).toBeNull();
		expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
	});

	it('lists the changed IDs as buttons', async () => {
		const p = props(done());
		render(TicketDetail, p);
		await userEvent.click(screen.getByRole('button', { name: 'REQ-009' }));
		expect(p.onopenid).toHaveBeenCalledWith('REQ-009');
	});

	it('shows the test result and that it is out of date', () => {
		render(TicketDetail, props(done()));
		expect(screen.getByText('7 passed, 1 failed')).toBeTruthy();
		expect(screen.getByText('out of date')).toBeTruthy();
	});

	it('says so when no test result was stored', () => {
		const t = done();
		t.report!.tests = null;
		render(TicketDetail, props(t));
		expect(screen.getByText(/No test result/)).toBeTruthy();
	});

	it('keeps each file diff closed until it is opened, read only', async () => {
		const { container } = render(TicketDetail, props(done()));
		const summary = screen.getByText('src/tasks/Task.ts', { selector: 'summary' });
		const details = summary.closest('details')!;
		expect(details.open).toBe(false);
		expect(container.querySelector('.viewer')).toBeNull();
		await userEvent.click(summary);
		expect(details.open).toBe(true);
		await waitFor(() => expect(container.querySelector('.cm-content')).not.toBeNull());
		expect(container.querySelector('.cm-content')!.textContent).toContain('+dueDate: string');
		expect(container.querySelector('.cm-content')!.getAttribute('contenteditable')).toBe('false');
	});
});

describe('TicketDetail plain text', () => {
	const evil = '<img src=x onerror=alert(1)>';

	it('shows plan steps and file paths as text', () => {
		const t = ticketOf({ plan: { entry: 'P1', affectedIds: [], files: [evil], steps: [evil] } });
		const { container } = render(TicketDetail, props(t));
		expect(container.querySelector('img')).toBeNull();
		expect(screen.getByRole('list', { name: 'Plan steps' }).textContent).toBe(evil);
		expect(screen.getByRole('button', { name: evil })).toBeTruthy();
	});

	it('shows report step summaries and paths as text', () => {
		const t = ticketOf({
			status: 'done',
			report: {
				at: '2026-11-22T12:00:00.000Z',
				text: 'Done.',
				steps: [
					{ runId: 'r1', phase: 'P1', agent: 'a', status: 'done', summary: evil, files: [evil] }
				],
				changedIds: [],
				files: [],
				tests: null
			}
		});
		const { container } = render(TicketDetail, props(t));
		expect(container.querySelector('img')).toBeNull();
		expect(screen.getAllByText(evil)).toHaveLength(2);
	});

	it('keeps Still valid enabled', () => {
		render(TicketDetail, props(staleP4()));
		const button = screen.getByRole('button', { name: 'Still valid' });
		expect(button.hasAttribute('disabled')).toBe(false);
		expect(button.getAttribute('aria-busy')).toBeNull();
	});
});
